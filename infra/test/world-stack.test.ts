import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { beforeAll, describe, expect, it } from 'vitest';
import { SERVER_PATH, SERVER_PORT, WorldStack } from '../lib/world-stack.ts';

let template: Template;

/** The AMI lookup as cdk.context.json records it, with an AMI standing in for a real one. */
const AMI_CONTEXT_KEY =
  'ssm:account=123456789012:parameterName=/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-6.1-arm64:region=us-east-1';
const CACHED_AMI = 'ami-0123456789abcdef0';

/** A template value as text, with intrinsics shown as `{Ref X}` or `{X.Attr}` placeholders. */
function render(value: unknown): string {
  if (typeof value === 'string') return value;
  const node = value as Record<string, unknown>;
  if ('Fn::Join' in node) {
    const [separator, parts] = node['Fn::Join'] as [string, unknown[]];
    return parts.map(render).join(separator);
  }
  if ('Fn::Base64' in node) return render(node['Fn::Base64']);
  if ('Ref' in node) return `{Ref ${String(node.Ref)}}`;
  if ('Fn::GetAtt' in node) return `{${(node['Fn::GetAtt'] as string[]).join('.')}}`;
  return JSON.stringify(value);
}

/** The room server instance: its logical ID, and the template entry. */
function server(): [string, { Properties: Record<string, unknown>; [key: string]: unknown }] {
  const instances = Object.entries(template.findResources('AWS::EC2::Instance'));
  expect(instances).toHaveLength(1);
  return instances[0]! as [string, { Properties: Record<string, unknown> }];
}

beforeAll(() => {
  // Stand-in build output; the real one comes from scripts/build-assets.ts.
  const dir = mkdtempSync(join(tmpdir(), 'world-infra-'));
  const clientDir = join(dir, 'client');
  const serverDir = join(dir, 'server');
  mkdirSync(clientDir);
  mkdirSync(serverDir);
  writeFileSync(join(clientDir, 'index.html'), '<!doctype html>');
  writeFileSync(join(serverDir, 'index.js'), 'console.log("server")');

  const app = new App({ context: { [AMI_CONTEXT_KEY]: CACHED_AMI } });
  const stack = new WorldStack(app, 'Test', {
    env: { account: '123456789012', region: 'us-east-1' },
    clientDir,
    serverDir,
  });
  template = Template.fromStack(stack);
});

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

  it('keeps server logs in CloudWatch for two weeks', () => {
    template.hasResourceProperties('AWS::Logs::LogGroup', { RetentionInDays: 14 });
  });
});
