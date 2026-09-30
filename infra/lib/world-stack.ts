import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
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
    serverBundle.grantRead(role);

    const userData = UserData.forLinux();
    const bundleZip = userData.addS3DownloadCommand({
      bucket: serverBundle.bucket,
      bucketKey: serverBundle.s3ObjectKey,
    });
    userData.addCommands(...serverSetupCommands(bundleZip, logGroup.logGroupName));

    const instance = new Instance(this, 'Server', {
      vpc,
      vpcSubnets: { subnetType: SubnetType.PUBLIC },
      instanceType: InstanceType.of(InstanceClass.T4G, InstanceSize.MICRO),
      machineImage: MachineImage.latestAmazonLinux2023({ cpuType: AmazonLinuxCpuType.ARM_64 }),
      securityGroup: serverSecurityGroup,
      role,
      userData,
      userDataCausesReplacement: true,
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
          origin: new HttpOrigin(instance.instancePublicDnsName, {
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
    new CfnOutput(this, 'ShellCommand', {
      value: `aws ssm start-session --target ${instance.instanceId} --region ${this.region}`,
      description: 'Shell on the room server (no SSH keys needed)',
    });
    new CfnOutput(this, 'ServerLogGroup', { value: logGroup.logGroupName });
  }
}

/** Boot script: install a verified Node.js, unpack the server, run it under systemd, ship logs. */
export function serverSetupCommands(bundleZip: string, logGroupName: string): string[] {
  const nodeTarball = `node-${NODE_VERSION}-linux-arm64.tar.xz`;
  return [
    'set -euo pipefail',
    'dnf install -y amazon-cloudwatch-agent logrotate',

    // Node.js, pinned and checksum-verified.
    `curl -fsSL -o /tmp/${nodeTarball} https://nodejs.org/dist/${NODE_VERSION}/${nodeTarball}`,
    `echo "${NODE_SHA256}  /tmp/${nodeTarball}" | sha256sum -c -`,
    'mkdir -p /opt/node',
    `tar -xJf /tmp/${nodeTarball} -C /opt/node --strip-components=1`,

    // The server runs as an unprivileged user from a read-only location.
    'id world >/dev/null 2>&1 || useradd --system --no-create-home --shell /sbin/nologin world',
    'mkdir -p /opt/world /var/log/world',
    `python3 -m zipfile -e ${bundleZip} /opt/world`,
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

    `cat > /opt/aws/amazon-cloudwatch-agent/etc/world.json <<'AGENT'
{
  "logs": {
    "logs_collected": {
      "files": {
        "collect_list": [
          { "file_path": "/var/log/world/server.log", "log_group_name": "${logGroupName}", "log_stream_name": "{instance_id}" }
        ]
      }
    }
  }
}
AGENT`,
    '/opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a fetch-config -m ec2 -s -c file:/opt/aws/amazon-cloudwatch-agent/etc/world.json',
  ];
}
