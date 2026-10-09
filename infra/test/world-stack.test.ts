import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { App, Stack } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  LOG_MAX_SIZE,
  LOG_ROTATIONS,
  SERVER_PATH,
  SERVER_PORT,
  SITE_ASSETS_DIR,
  WorldStack,
  publicDnsName,
} from '../lib/world-stack.ts';

let template: Template;
let assemblyDir: string;

/** The AMI lookup as cdk.context.json records it, with an AMI standing in for a real one. */
const AMI_CONTEXT_KEY =
  'ssm:account=123456789012:parameterName=/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-6.1-arm64:region=us-east-1';
const CACHED_AMI = 'ami-0123456789abcdef0';

/**
 * Evaluates a template value the way CloudFormation would, taking Refs and GetAtts (`Id` or
 * `Id.Attr`) from `values`, and showing any others as `{Ref Id}` or `{Id.Attr}` placeholders.
 */
function evaluate(value: unknown, values: Record<string, string> = {}): string | string[] {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map((item) => String(evaluate(item, values)));
  const node = value as Record<string, unknown>;
  if ('Fn::Join' in node) {
    const [separator, parts] = node['Fn::Join'] as [string, unknown];
    return [evaluate(parts, values)].flat().join(separator);
  }
  if ('Fn::Split' in node) {
    const [separator, source] = node['Fn::Split'] as [string, unknown];
    return String(evaluate(source, values)).split(separator);
  }
  if ('Fn::Base64' in node) return evaluate(node['Fn::Base64'], values);
  if ('Ref' in node) return values[String(node.Ref)] ?? `{Ref ${String(node.Ref)}}`;
  if ('Fn::GetAtt' in node) {
    const name = (node['Fn::GetAtt'] as string[]).join('.');
    return values[name] ?? `{${name}}`;
  }
  return JSON.stringify(value);
}

/** A template value as text, with intrinsics shown as placeholders. */
const render = (value: unknown): string => String(evaluate(value));

/** A resource as the template has it. */
interface Resource {
  Properties: Record<string, unknown>;
  DependsOn?: string[];
  [key: string]: unknown;
}

/** The template's resources of a type, by logical ID. */
function resources(type: string): [string, Resource][] {
  return Object.entries(template.findResources(type)) as [string, Resource][];
}

/** The room server instance: its logical ID, and the template entry. */
function server(): [string, Resource] {
  const instances = resources('AWS::EC2::Instance');
  expect(instances).toHaveLength(1);
  return instances[0]!;
}

beforeAll(() => {
  // Stand-in build output; the real one comes from scripts/build-assets.ts.
  const dir = mkdtempSync(join(tmpdir(), 'world-infra-'));
  const clientDir = join(dir, 'client');
  const serverDir = join(dir, 'server');
  mkdirSync(join(clientDir, SITE_ASSETS_DIR), { recursive: true });
  mkdirSync(serverDir);
  writeFileSync(join(clientDir, 'index.html'), '<!doctype html>');
  writeFileSync(join(clientDir, 'favicon.svg'), '<svg/>');
  writeFileSync(join(clientDir, SITE_ASSETS_DIR, 'main-B8FjIsg3.js'), 'export {}');
  writeFileSync(join(serverDir, 'index.js'), 'console.log("server")');

  const app = new App({ context: { [AMI_CONTEXT_KEY]: CACHED_AMI } });
  const stack = new WorldStack(app, 'Test', {
    env: { account: '123456789012', region: 'us-east-1' },
    clientDir,
    serverDir,
  });
  template = Template.fromStack(stack);
  assemblyDir = app.synth().directory;
});

/** The files a BucketDeployment uploads, as staged in the cloud assembly. */
function uploads(deployment: Resource): string[] {
  const [zip] = deployment.Properties.SourceObjectKeys as string[];
  return readdirSync(join(assemblyDir, `asset.${zip!.replace(/\.zip$/, '')}`), {
    recursive: true,
  }).map(String);
}

describe('WorldStack', () => {
  it('serves the site from a private, encrypted bucket through Origin Access Control', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
      BucketEncryption: Match.objectLike({}),
    });
    template.resourceCountIs('AWS::CloudFront::OriginAccessControl', 1);
  });

  it('keeps every hashed file of earlier builds, cached for good, and has pages checked each visit', () => {
    const deployments = resources('Custom::CDKBucketDeployment');
    expect(deployments).toHaveLength(2);
    const [hashedId, hashed] = deployments.find(
      ([, d]) => d.Properties.DestinationBucketKeyPrefix === `${SITE_ASSETS_DIR}/`,
    )!;
    const [, pages] = deployments.find(([id]) => id !== hashedId)!;

    // Hashed names never mean two things, so nothing a tab opened earlier may still load is removed.
    expect(hashed.Properties).toMatchObject({
      Prune: false,
      SystemMetadata: { 'cache-control': 'public, max-age=31536000, immutable' },
    });
    expect(uploads(hashed)).toEqual(['main-B8FjIsg3.js']);

    // The pages are revalidated, pruned except for assets/, and go up after what they name.
    expect(pages.Properties).toMatchObject({
      Prune: true,
      Exclude: [`${SITE_ASSETS_DIR}/*`],
      SystemMetadata: { 'cache-control': 'no-cache' },
      DistributionPaths: ['/*'],
    });
    expect(pages.Properties.DestinationBucketKeyPrefix).toBeUndefined();
    expect(uploads(pages).sort()).toEqual(['favicon.svg', 'index.html']);
    expect(pages.DependsOn).toContain(hashedId);
  });

  it('routes /ws* to the room server with caching off and upgrade headers forwarded', () => {
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        DefaultRootObject: 'index.html',
        DefaultCacheBehavior: Match.objectLike({ ViewerProtocolPolicy: 'redirect-to-https' }),
        CacheBehaviors: [
          Match.objectLike({
            PathPattern: `${SERVER_PATH}*`,
            ViewerProtocolPolicy: 'https-only',
            // Managed CachingDisabled and AllViewerExceptHostHeader policies.
            CachePolicyId: '4135ea2d-6df8-44a3-9df3-4b5a84be39ad',
            OriginRequestPolicyId: 'b689b0a8-53d0-40ab-baf2-68738e2966ac',
            AllowedMethods: Match.arrayWith(['GET', 'OPTIONS', 'POST']),
          }),
        ],
        Origins: Match.arrayWith([
          Match.objectLike({
            CustomOriginConfig: Match.objectLike({
              HTTPPort: SERVER_PORT,
              OriginProtocolPolicy: 'http-only',
            }),
          }),
        ]),
      }),
    });
  });

  it('reaches the room server at an Elastic IP, by a name that survives stop, start and deploys', () => {
    const [instanceId] = server();
    const addresses = Object.entries(template.findResources('AWS::EC2::EIP'));
    expect(addresses).toHaveLength(1);
    const [addressId, address] = addresses[0]!;
    expect(address.Properties).toMatchObject({ Domain: 'vpc', InstanceId: { Ref: instanceId } });

    const distribution = Object.values(
      template.findResources('AWS::CloudFront::Distribution'),
    )[0] as { Properties: { DistributionConfig: { Origins: Record<string, unknown>[] } } };
    const origin = distribution.Properties.DistributionConfig.Origins.find(
      (o) => 'CustomOriginConfig' in o,
    )!;
    const sample = { [`${addressId}.PublicIp`]: '203.0.113.7', 'AWS::URLSuffix': 'amazonaws.com' };
    expect(evaluate(origin.DomainName, sample)).toBe('ec2-203-0-113-7.compute-1.amazonaws.com');
    // Nothing of the instance's own address or name, which change on every stop and start.
    expect(JSON.stringify(origin)).not.toContain(instanceId);
  });

  it('names the address as EC2 does outside us-east-1 too', () => {
    const stack = new Stack(new App(), 'Elsewhere', {
      env: { account: '123456789012', region: 'eu-west-1' },
    });
    const name = stack.resolve(publicDnsName(stack, '203.0.113.7')) as unknown;
    expect(evaluate(name, { 'AWS::URLSuffix': 'amazonaws.com' })).toBe(
      'ec2-203-0-113-7.eu-west-1.compute.amazonaws.com',
    );
  });

  it('associates the Elastic IP, and boots the server, only once the subnet has its way out', () => {
    const route = Object.keys(template.findResources('AWS::EC2::Route'));
    expect(route).toHaveLength(1);
    template.hasResource('AWS::EC2::EIP', { DependsOn: Match.arrayWith(route) });
    template.hasResource('AWS::EC2::Instance', { DependsOn: Match.arrayWith(route) });
  });

  it('lets only CloudFront reach the server, on the server port only', () => {
    template.resourceCountIs('AWS::EC2::SecurityGroupIngress', 1);
    template.hasResourceProperties('AWS::EC2::SecurityGroupIngress', {
      FromPort: SERVER_PORT,
      ToPort: SERVER_PORT,
      IpProtocol: 'tcp',
      SourcePrefixListId: Match.anyValue(),
      CidrIp: Match.absent(),
    });
    // No inline rules that could open anything else.
    template.hasResourceProperties('AWS::EC2::SecurityGroup', {
      SecurityGroupIngress: Match.absent(),
    });
  });

  it('runs a small Graviton instance with IMDSv2, an encrypted disk, and no SSH key', () => {
    template.hasResourceProperties('AWS::EC2::Instance', {
      InstanceType: 't4g.micro',
      BlockDeviceMappings: [
        Match.objectLike({ Ebs: Match.objectLike({ Encrypted: true, VolumeType: 'gp3' }) }),
      ],
      KeyName: Match.absent(),
    });
    template.hasResourceProperties('AWS::EC2::LaunchTemplate', {
      LaunchTemplateData: Match.objectLike({ MetadataOptions: { HttpTokens: 'required' } }),
    });
  });

  it('does not pay for a NAT gateway', () => {
    template.resourceCountIs('AWS::EC2::NatGateway', 0);
  });

  it('grants the instance Systems Manager and only its own log group', () => {
    template.hasResourceProperties('AWS::IAM::Role', {
      ManagedPolicyArns: Match.arrayWith([
        Match.objectLike({
          'Fn::Join': Match.arrayWith([
            Match.arrayWith([Match.stringLikeRegexp('AmazonSSMManagedInstanceCore')]),
          ]),
        }),
      ]),
    });
    const policies = JSON.stringify(template.findResources('AWS::IAM::Policy'));
    expect(policies).toContain('logs:PutLogEvents');
    expect(policies).not.toMatch(
      /"Resource":"\*"[^}]*logs:PutLogEvents|logs:PutLogEvents[^}]*"Resource":"\*"/,
    );
  });

  it('lets the instance read its own server bundle and nothing else in the assets bucket', () => {
    type Policy = {
      Properties: {
        Roles: unknown;
        PolicyDocument: { Statement: { Action: unknown; Resource: unknown }[] };
      };
    };
    const policies = Object.values(template.findResources('AWS::IAM::Policy')) as Policy[];
    const policy = policies.find((p) => JSON.stringify(p.Properties.Roles).includes('ServerRole'))!;
    const s3 = policy.Properties.PolicyDocument.Statement.filter((s) =>
      [s.Action].flat().some((action) => String(action).startsWith('s3:')),
    );
    expect(s3).toHaveLength(1);
    expect(s3[0]!.Action).toBe('s3:GetObject');
    expect(render(s3[0]!.Resource)).toMatch(
      /^arn:\{Ref AWS::Partition\}:s3:::cdk-hnb659fds-assets-123456789012-us-east-1\/[0-9a-f]{64}\.zip$/,
    );
  });

  it('self-heals: recover on host failure, reboot on instance failure', () => {
    const alarms = Object.values(template.findResources('AWS::CloudWatch::Alarm')).map((alarm) =>
      JSON.stringify(alarm),
    );
    expect(alarms.find((a) => a.includes('StatusCheckFailed_System'))).toContain(':ec2:recover');
    expect(alarms.find((a) => a.includes('StatusCheckFailed_Instance'))).toContain(':ec2:reboot');
  });

  it('boots the server as an unprivileged systemd service on a verified Node.js', () => {
    const instances = template.findResources('AWS::EC2::Instance');
    const userData = JSON.stringify(Object.values(instances)[0]);
    expect(userData).toContain('sha256sum -c');
    expect(userData).toContain('User=world');
    expect(userData).toContain(`BASE_PATH=${SERVER_PATH}`);
    expect(userData).toContain('TRUST_PROXY=1');
  });

  it('holds a deploy until the new server answers its health check, and fails it otherwise', () => {
    const [id, instance] = server();
    // One signal (CloudFormation's default count) within ten minutes, or the deploy rolls back.
    expect(instance.CreationPolicy).toEqual({ ResourceSignal: { Timeout: 'PT10M' } });
    const script = render(instance.Properties.UserData);
    // However the script ends, the exit trap signals this instance with the script's exit code.
    expect(script).toMatch(/^#!\/bin\/bash\nfunction exitTrap\(\)\{\nexitCode=\$\?\n/);
    expect(script).toContain('trap exitTrap EXIT');
    expect(script).toContain(
      `/opt/aws/bin/cfn-signal --stack Test --resource ${id} --region us-east-1 -e $exitCode`,
    );
    // Every step can fail the script, from the first download on.
    expect(script.indexOf('set -euo pipefail')).toBeLessThan(script.indexOf('dnf install'));
    expect(script.indexOf('set -euo pipefail')).toBeLessThan(script.indexOf('aws s3 cp'));
    // The last step waits for the server's health check, through the path CloudFront forwards.
    const steps = script.trimEnd().split('\n');
    expect(steps.at(-2)).toMatch(
      new RegExp(
        `^timeout \\d+ bash -c 'until curl -fsS -o /dev/null http://127\\.0\\.0\\.1:${SERVER_PORT}${SERVER_PATH}/health; do sleep 1; done'$`,
      ),
    );
    expect(steps.indexOf('systemctl enable --now world.service')).toBeLessThan(steps.length - 2);
  });

  it('boots the AMI recorded in cdk.context.json, not whichever is newest at deploy time', () => {
    expect(server()[1].Properties.ImageId).toBe(CACHED_AMI);
    // No SSM parameter that CloudFormation would resolve afresh, and replace the instance for.
    expect(JSON.stringify(template.toJSON().Parameters ?? {})).not.toContain(
      'ami-amazon-linux-latest',
    );
  });

  it('ships the boot log before the steps that can fail, so a rolled back boot leaves it', () => {
    const script = render(server()[1].Properties.UserData);
    expect(script).toContain('"file_path": "/var/log/cloud-init-output.log"');
    expect(script.indexOf('amazon-cloudwatch-agent-ctl')).toBeLessThan(script.indexOf('aws s3 cp'));
    expect(script.indexOf('amazon-cloudwatch-agent-ctl')).toBeLessThan(
      script.indexOf('https://nodejs.org'),
    );
  });

  it('bounds the server log on disk by size, checked hourly, not only by age', () => {
    const script = render(server()[1].Properties.UserData);
    const rotation = /\/var\/log\/world\/server\.log \{\n([^}]*)\}/.exec(script)?.[1] ?? '';
    expect(rotation).toContain(`maxsize ${LOG_MAX_SIZE}`);
    expect(rotation).toContain(`rotate ${LOG_ROTATIONS}`);
    expect(rotation).toContain('compress');
    expect(LOG_MAX_SIZE).toMatch(/^\d+M$/);
    expect(LOG_ROTATIONS).toBeLessThanOrEqual(10);
    // maxsize only acts when logrotate runs: hourly here, rather than the timer's daily.
    expect(script).toContain('OnCalendar=hourly');
    expect(script).toContain('systemctl enable --now logrotate.timer');
  });

  it('keeps server logs in CloudWatch for two weeks', () => {
    template.hasResourceProperties('AWS::Logs::LogGroup', { RetentionInDays: 14 });
  });
});
