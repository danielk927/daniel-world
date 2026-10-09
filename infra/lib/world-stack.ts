import { CfnOutput, Duration, Fn, RemovalPolicy, Stack, Token, type StackProps } from 'aws-cdk-lib';
import { Alarm, ComparisonOperator, Metric, TreatMissingData } from 'aws-cdk-lib/aws-cloudwatch';
import { Ec2Action, Ec2InstanceAction } from 'aws-cdk-lib/aws-cloudwatch-actions';
import {
  AllowedMethods,
  CachePolicy,
  Distribution,
  HttpVersion,
  OriginProtocolPolicy,
  OriginRequestPolicy,
  PriceClass,
  ResponseHeadersPolicy,
  ViewerProtocolPolicy,
} from 'aws-cdk-lib/aws-cloudfront';
import { HttpOrigin, S3BucketOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import {
  BlockDeviceVolume,
  CfnEIP,
  EbsDeviceVolumeType,
  Instance,
  InstanceClass,
  InstanceSize,
  InstanceType,
  MachineImage,
  Peer,
  Port,
  PrefixList,
  SecurityGroup,
  SubnetType,
  UserData,
  Vpc,
  AmazonLinuxCpuType,
} from 'aws-cdk-lib/aws-ec2';
import { ManagedPolicy, PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { BlockPublicAccess, Bucket, BucketEncryption } from 'aws-cdk-lib/aws-s3';
import { Asset } from 'aws-cdk-lib/aws-s3-assets';
import { BucketDeployment, Source } from 'aws-cdk-lib/aws-s3-deployment';
import type { Construct } from 'constructs';

export interface WorldStackProps extends StackProps {
  /** Built static client (see scripts/build-assets.ts). */
  clientDir: string;
  /** Directory holding the single-file server bundle `index.js`. */
  serverDir: string;
}

/** Port the room server listens on inside the instance. Only CloudFront can reach it. */
export const SERVER_PORT = 3001;
/** CloudFront forwards this path prefix (WebSocket and HTTP) to the room server. */
export const SERVER_PATH = '/ws';

// Pinned Node.js runtime for the instance, verified by checksum before it is used.
const NODE_VERSION = 'v24.21.0';
const NODE_SHA256 = '6ad1325edbdb5649c379b75a237147a666c95d4f9ae8d340fef2d1575d289ad2';

/**
 * How long a deploy waits for a new instance to boot and answer its health check. A boot takes a
 * minute or two (packages, Node.js); a failing step signals at once, so this only bounds a hang.
 */
export const BOOT_TIMEOUT = Duration.minutes(10);
/** How long the boot script gives the freshly started server to answer its health check. */
const HEALTH_WAIT_SECONDS = 60;

/**
 * The whole site on AWS:
 *
 *   visitor ──HTTPS──▶ CloudFront ─┬─ /*    ──▶ S3 bucket (private, Origin Access Control)
 *                                  └─ /ws*  ──▶ EC2 room server (Graviton, port 3001)
 *
 * One domain serves both, so the page reaches the server at wss://<same host>/ws with CloudFront's
 * certificate and no custom domain. The instance accepts traffic only from CloudFront, has no SSH
 * (Systems Manager instead), ships logs to CloudWatch, and recovers itself if its host fails.
 */
export class WorldStack extends Stack {
  constructor(scope: Construct, id: string, props: WorldStackProps) {
    super(scope, id, props);

    // Networking: one public subnet, no NAT gateway (nothing here needs private egress).
    const vpc = new Vpc(this, 'Vpc', {
      maxAzs: 1,
      natGateways: 0,
      subnetConfiguration: [{ name: 'public', subnetType: SubnetType.PUBLIC, cidrMask: 24 }],
    });

    const serverSecurityGroup = new SecurityGroup(this, 'ServerSecurityGroup', {
      vpc,
      description: 'Room server: reachable only from CloudFront',
      allowAllOutbound: true,
    });
    const cloudFrontOrigins = PrefixList.fromLookup(this, 'CloudFrontOriginFacing', {
      prefixListName: 'com.amazonaws.global.cloudfront.origin-facing',
    });
    serverSecurityGroup.addIngressRule(
      Peer.prefixList(cloudFrontOrigins.prefixListId),
      Port.tcp(SERVER_PORT),
      'CloudFront to room server',
    );

    const logGroup = new LogGroup(this, 'ServerLogs', {
      retention: RetentionDays.TWO_WEEKS,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const role = new Role(this, 'ServerRole', {
      assumedBy: new ServicePrincipal('ec2.amazonaws.com'),
      description: 'Room server instance: Systems Manager access and its own log group',
      managedPolicies: [ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore')],
    });
    role.addToPolicy(
      new PolicyStatement({
        actions: [
          'logs:CreateLogGroup',
          'logs:CreateLogStream',
          'logs:PutLogEvents',
          'logs:DescribeLogStreams',
        ],
        resources: [logGroup.logGroupArn, `${logGroup.logGroupArn}:*`],
      }),
    );

    // The server bundle travels as a CDK asset; a new bundle means a new instance (immutable deploys).
    const serverBundle = new Asset(this, 'ServerBundle', { path: props.serverDir });
    // Only this bundle, not the whole CDK assets bucket (every asset of every stack in the account).
    role.addToPolicy(
      new PolicyStatement({
        actions: ['s3:GetObject'],
        resources: [serverBundle.bucket.arnForObjects(serverBundle.s3ObjectKey)],
      }),
    );

    const userData = UserData.forLinux();
    userData.addCommands(
      ...serverSetupCommands({
        bundleUrl: serverBundle.s3ObjectUrl,
        logGroupName: logGroup.logGroupName,
      }),
    );

    const instance = new Instance(this, 'Server', {
      vpc,
      vpcSubnets: { subnetType: SubnetType.PUBLIC },
      instanceType: InstanceType.of(InstanceClass.T4G, InstanceSize.MICRO),
      // The AMI is looked up once and kept in cdk.context.json, so a new Amazon Linux release
      // never replaces the instance (and drops every room) on a deploy that changed nothing here.
      // README's deployment section says how to move to a newer one on purpose.
      machineImage: MachineImage.latestAmazonLinux2023({
        cpuType: AmazonLinuxCpuType.ARM_64,
        cachedInContext: true,
      }),
      securityGroup: serverSecurityGroup,
      role,
      userData,
      userDataCausesReplacement: true,
      // CloudFormation holds the deploy until the boot script signals (see serverSetupCommands).
      resourceSignalTimeout: BOOT_TIMEOUT,
      requireImdsv2: true,
      blockDevices: [
        {
          deviceName: '/dev/xvda',
          volume: BlockDeviceVolume.ebs(8, {
            volumeType: EbsDeviceVolumeType.GP3,
            encrypted: true,
          }),
        },
      ],
    });
    // However the boot script ends, it tells CloudFormation: success only if every step ran and the
    // server answered its health check. A failure, or no word within BOOT_TIMEOUT, rolls the deploy
    // back, so the old instance keeps serving and the stack never reports a broken one as complete.
    // On a failure it first gives the log agent a moment to ship the boot log, since the instance
    // is deleted with the rollback.
    userData.addOnExitCommands(
      'if [ "$exitCode" -ne 0 ]; then sleep 15; fi',
      `/opt/aws/bin/cfn-signal --stack ${this.stackName} --resource ${instance.instance.logicalId} --region ${this.region} -e $exitCode || echo 'Could not send the CloudFormation signal'`,
    );

    // A fixed address for CloudFront to reach the server by. An instance's own public IP, and the
    // DNS name made from it, change on every stop and start (AWS maintenance included), which would
    // leave the origin pointing nowhere until the next deploy. The Elastic IP stays through those,
    // and a deploy that replaces the instance moves it to the new one once that one has passed its
    // health check, so the origin never changes. (The instance still gets its own public IP at
    // launch, to fetch what it needs while it boots; the Elastic IP takes its place.)
    const serverIp = new CfnEIP(this, 'ServerIp', {
      domain: 'vpc',
      instanceId: instance.instanceId,
      tags: [{ key: 'Name', value: `${this.stackName}-room-server` }],
    });
    const serverOrigin = publicDnsName(this, serverIp.attrPublicIp);
    // Both need the subnet's route to the internet gateway, which depends on the gateway's
    // attachment: the Elastic IP to be associated, and the boot to fetch packages, Node.js and the
    // bundle and to signal (in a new stack, the instance could otherwise boot before the route).
    const internet = vpc.selectSubnets({
      subnetType: SubnetType.PUBLIC,
    }).internetConnectivityEstablished;
    instance.node.addDependency(internet);
    serverIp.node.addDependency(internet);

    // Self-healing: recover onto new hardware if the host fails, reboot if the OS stops responding.
    const statusCheck = (metricName: string): Metric =>
      new Metric({
        namespace: 'AWS/EC2',
        metricName,
        dimensionsMap: { InstanceId: instance.instanceId },
        statistic: 'Maximum',
        period: Duration.minutes(1),
      });
    new Alarm(this, 'SystemStatusAlarm', {
      alarmDescription: 'Host failure: recover the room server onto healthy hardware',
      metric: statusCheck('StatusCheckFailed_System'),
      threshold: 1,
      evaluationPeriods: 2,
      comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: TreatMissingData.MISSING,
    }).addAlarmAction(new Ec2Action(Ec2InstanceAction.RECOVER));
    new Alarm(this, 'InstanceStatusAlarm', {
      alarmDescription: 'Instance unresponsive: reboot the room server',
      metric: statusCheck('StatusCheckFailed_Instance'),
      threshold: 1,
      evaluationPeriods: 3,
      comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: TreatMissingData.MISSING,
    }).addAlarmAction(new Ec2Action(Ec2InstanceAction.REBOOT));

    // Static site: private bucket, readable only by this distribution.
    const siteBucket = new Bucket(this, 'SiteBucket', {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const distribution = new Distribution(this, 'Distribution', {
      comment: "Daniel's World",
      defaultRootObject: 'index.html',
      httpVersion: HttpVersion.HTTP2_AND_3,
      priceClass: PriceClass.PRICE_CLASS_100,
      defaultBehavior: {
        origin: S3BucketOrigin.withOriginAccessControl(siteBucket),
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy: ResponseHeadersPolicy.SECURITY_HEADERS,
        compress: true,
      },
      additionalBehaviors: {
        [`${SERVER_PATH}*`]: {
          origin: new HttpOrigin(serverOrigin, {
            protocolPolicy: OriginProtocolPolicy.HTTP_ONLY,
            httpPort: SERVER_PORT,
            readTimeout: Duration.seconds(30),
          }),
          viewerProtocolPolicy: ViewerProtocolPolicy.HTTPS_ONLY,
          allowedMethods: AllowedMethods.ALLOW_ALL,
          cachePolicy: CachePolicy.CACHING_DISABLED,
          // Forwards the WebSocket upgrade headers; the origin gets its own Host header.
          originRequestPolicy: OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        },
      },
    });

    new BucketDeployment(this, 'DeploySite', {
      sources: [Source.asset(props.clientDir)],
      destinationBucket: siteBucket,
      distribution,
      distributionPaths: ['/*'],
      prune: true,
    });

    new CfnOutput(this, 'SiteUrl', { value: `https://${distribution.distributionDomainName}` });
    new CfnOutput(this, 'ServerUrl', {
      value: `wss://${distribution.distributionDomainName}${SERVER_PATH}`,
      description: 'Use as VITE_SERVER_URL for a client hosted elsewhere (e.g. Vercel)',
    });
    new CfnOutput(this, 'InstanceId', { value: instance.instanceId });
    new CfnOutput(this, 'ServerOrigin', {
      value: serverOrigin,
      description: "CloudFront's way to the room server: the Elastic IP's public DNS name",
    });
    new CfnOutput(this, 'ShellCommand', {
      value: `aws ssm start-session --target ${instance.instanceId} --region ${this.region}`,
      description: 'Shell on the room server (no SSH keys needed)',
    });
    new CfnOutput(this, 'ServerLogGroup', { value: logGroup.logGroupName });
  }
}

/**
 * The public DNS name EC2 gives a public IPv4 address, for a CloudFront origin (which takes a name,
 * not an address): `ec2-203-0-113-7.compute-1.amazonaws.com` in us-east-1, and
 * `ec2-203-0-113-7.<region>.compute.amazonaws.com` elsewhere. Outside AWS it resolves to the address
 * itself. CloudFormation offers no such attribute for an Elastic IP, so it is built from the address.
 */
export function publicDnsName(stack: Stack, ip: string): string {
  if (Token.isUnresolved(stack.region)) {
    throw new Error('The room server origin needs a stack with a concrete region (env.region)');
  }
  const domain = stack.region === 'us-east-1' ? 'compute-1' : `${stack.region}.compute`;
  return `ec2-${Fn.join('-', Fn.split('.', ip))}.${domain}.${stack.urlSuffix}`;
}

export interface ServerSetup {
  /** `s3://` URL of the zipped server bundle. */
  bundleUrl: string;
  /** CloudWatch log group for the boot log and the server log. */
  logGroupName: string;
}

/**
 * Boot script: ship logs, install a verified Node.js, unpack the server, run it under systemd, and
 * finish only once the server answers its health check. Any failing step ends the script there, and
 * the exit trap the stack adds signals CloudFormation with its exit code.
 */
export function serverSetupCommands({ bundleUrl, logGroupName }: ServerSetup): string[] {
  const nodeTarball = `node-${NODE_VERSION}-linux-arm64.tar.xz`;
  // Through the same path prefix CloudFront forwards, so the check covers BASE_PATH too.
  const healthUrl = `http://127.0.0.1:${SERVER_PORT}${SERVER_PATH}/health`;
  return [
    'set -euo pipefail',
    // CloudFormation only hears that the boot failed; the boot log says which step.
    `trap 'echo "Boot failed at line $LINENO: $BASH_COMMAND" >&2' ERR`,
    'dnf install -y amazon-cloudwatch-agent aws-cfn-bootstrap logrotate',

    // Logs ship first, so a boot that fails later still leaves its log after the rollback deletes
    // the instance.
    `cat > /opt/aws/amazon-cloudwatch-agent/etc/world.json <<'AGENT'
{
  "logs": {
    "logs_collected": {
      "files": {
        "collect_list": [
          { "file_path": "/var/log/cloud-init-output.log", "log_group_name": "${logGroupName}", "log_stream_name": "{instance_id}-boot" },
          { "file_path": "/var/log/world/server.log", "log_group_name": "${logGroupName}", "log_stream_name": "{instance_id}" }
        ]
      }
    }
  }
}
AGENT`,
    '/opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a fetch-config -m ec2 -s -c file:/opt/aws/amazon-cloudwatch-agent/etc/world.json',

    // Node.js, pinned and checksum-verified.
    `curl -fsSL -o /tmp/${nodeTarball} https://nodejs.org/dist/${NODE_VERSION}/${nodeTarball}`,
    `echo "${NODE_SHA256}  /tmp/${nodeTarball}" | sha256sum -c -`,
    'mkdir -p /opt/node',
    `tar -xJf /tmp/${nodeTarball} -C /opt/node --strip-components=1`,

    // The server runs as an unprivileged user from a read-only location.
    'id world >/dev/null 2>&1 || useradd --system --no-create-home --shell /sbin/nologin world',
    'mkdir -p /opt/world /var/log/world',
    `aws s3 cp '${bundleUrl}' /tmp/server.zip`,
    'python3 -m zipfile -e /tmp/server.zip /opt/world',
    'chown -R root:root /opt/world && chown world:world /var/log/world',

    `cat > /etc/systemd/system/world.service <<'UNIT'
[Unit]
Description=Daniel's World room server
After=network-online.target
Wants=network-online.target

[Service]
User=world
Environment=NODE_ENV=production PORT=${SERVER_PORT} BASE_PATH=${SERVER_PATH} TRUST_PROXY=1
ExecStart=/opt/node/bin/node /opt/world/index.js
Restart=always
RestartSec=2
StandardOutput=append:/var/log/world/server.log
StandardError=append:/var/log/world/server.log
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=/var/log/world

[Install]
WantedBy=multi-user.target
UNIT`,
    `cat > /etc/logrotate.d/world <<'ROTATE'
/var/log/world/server.log {
  weekly
  rotate 4
  compress
  missingok
  copytruncate
}
ROTATE`,
    'systemctl daemon-reload',
    'systemctl enable --now world.service',

    // The deploy's gate: the script, and so the signal, succeeds only once the server answers.
    `timeout ${HEALTH_WAIT_SECONDS} bash -c 'until curl -fsS -o /dev/null ${healthUrl}; do sleep 1; done'`,
    'echo "Room server is up"',
  ];
}
