import {
  CreateTableCommand,
  DeleteTableCommand,
  DynamoDBClient,
  ListTablesCommand,
} from '@aws-sdk/client-dynamodb';
import {
  DescribeInstancesCommand,
  EC2Client,
  RunInstancesCommand,
  TerminateInstancesCommand,
} from '@aws-sdk/client-ec2';
import {
  CreateBucketCommand,
  DeleteBucketCommand,
  ListBucketsCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import {
  CreateSecretCommand,
  DeleteSecretCommand,
  ListSecretsCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';
import {
  CreateTopicCommand,
  DeleteTopicCommand,
  ListTopicsCommand,
  SNSClient,
} from '@aws-sdk/client-sns';
import {
  CreateQueueCommand,
  DeleteQueueCommand,
  GetQueueUrlCommand,
  ListQueuesCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';

export const SERVICES = ['s3', 'sqs', 'sns', 'dynamodb', 'ec2', 'secrets'] as const;
export type ServiceId = (typeof SERVICES)[number];

export interface ResourceItem {
  id: string;
  name: string;
  detail?: string;
  createdAt?: string;
}

const clientConfig = (endpoint: string) => ({
  endpoint,
  region: 'us-east-1',
  credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
});

export class ResourceGateway {
  private endpoint: string;

  constructor(endpoint: string) {
    this.endpoint = endpoint;
  }

  async list(service: ServiceId): Promise<ResourceItem[]> {
    switch (service) {
      case 's3': {
        const s3 = new S3Client({ ...clientConfig(this.endpoint), forcePathStyle: true });
        const out = await s3.send(new ListBucketsCommand({}));
        return (out.Buckets ?? []).map((bucket) => ({
          id: bucket.Name ?? '',
          name: bucket.Name ?? '',
          createdAt: bucket.CreationDate?.toISOString(),
        }));
      }
      case 'sqs': {
        const sqs = new SQSClient(clientConfig(this.endpoint));
        const out = await sqs.send(new ListQueuesCommand({}));
        return (out.QueueUrls ?? []).map((url) => {
          const name = url.split('/').pop() ?? url;
          return { id: name, name, detail: url };
        });
      }
      case 'sns': {
        const sns = new SNSClient(clientConfig(this.endpoint));
        const out = await sns.send(new ListTopicsCommand({}));
        return (out.Topics ?? []).flatMap((topic) => {
          if (!topic.TopicArn) {
            return [];
          }
          const name = topic.TopicArn.split(':').pop() ?? topic.TopicArn;
          return [{ id: topic.TopicArn, name, detail: topic.TopicArn }];
        });
      }
      case 'dynamodb': {
        const ddb = new DynamoDBClient(clientConfig(this.endpoint));
        const out = await ddb.send(new ListTablesCommand({}));
        return (out.TableNames ?? []).map((table) => ({ id: table, name: table }));
      }
      case 'ec2': {
        const ec2 = new EC2Client(clientConfig(this.endpoint));
        const out = await ec2.send(new DescribeInstancesCommand({}));
        const items: ResourceItem[] = [];
        for (const reservation of out.Reservations ?? []) {
          for (const instance of reservation.Instances ?? []) {
            const state = instance.State?.Name ?? 'unknown';
            if (state === 'terminated' || !instance.InstanceId) {
              continue;
            }
            const nameTag = instance.Tags?.find((tag) => tag.Key === 'Name')?.Value;
            items.push({
              id: instance.InstanceId,
              name: nameTag || instance.InstanceId,
              detail: `${instance.InstanceType ?? ''} · ${state}`,
              createdAt: instance.LaunchTime?.toISOString(),
            });
          }
        }
        return items;
      }
      case 'secrets': {
        const secrets = new SecretsManagerClient(clientConfig(this.endpoint));
        const out = await secrets.send(new ListSecretsCommand({}));
        return (out.SecretList ?? []).flatMap((secret) => {
          if (!secret.Name) {
            return [];
          }
          return [{ id: secret.Name, name: secret.Name, detail: secret.ARN }];
        });
      }
    }
  }

  async create(service: ServiceId, name: string, value?: string): Promise<ResourceItem> {
    switch (service) {
      case 's3': {
        const s3 = new S3Client({ ...clientConfig(this.endpoint), forcePathStyle: true });
        await s3.send(new CreateBucketCommand({ Bucket: name }));
        return { id: name, name };
      }
      case 'sqs': {
        const sqs = new SQSClient(clientConfig(this.endpoint));
        const out = await sqs.send(new CreateQueueCommand({ QueueName: name }));
        return { id: name, name, detail: out.QueueUrl };
      }
      case 'sns': {
        const sns = new SNSClient(clientConfig(this.endpoint));
        const out = await sns.send(new CreateTopicCommand({ Name: name }));
        return { id: out.TopicArn ?? name, name, detail: out.TopicArn };
      }
      case 'dynamodb': {
        const ddb = new DynamoDBClient(clientConfig(this.endpoint));
        await ddb.send(
          new CreateTableCommand({
            TableName: name,
            AttributeDefinitions: [{ AttributeName: 'id', AttributeType: 'S' }],
            KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
            BillingMode: 'PAY_PER_REQUEST',
          }),
        );
        return { id: name, name, detail: 'partition key: id (S)' };
      }
      case 'ec2': {
        const ec2 = new EC2Client(clientConfig(this.endpoint));
        const out = await ec2.send(
          new RunInstancesCommand({
            ImageId: 'ami-0abcdef1234567890',
            InstanceType: 't3.micro',
            MinCount: 1,
            MaxCount: 1,
            TagSpecifications: [
              { ResourceType: 'instance', Tags: [{ Key: 'Name', Value: name }] },
            ],
          }),
        );
        const instance = out.Instances?.[0];
        return {
          id: instance?.InstanceId ?? name,
          name,
          detail: `${instance?.InstanceType ?? 't3.micro'} · ${instance?.State?.Name ?? 'pending'}`,
        };
      }
      case 'secrets': {
        const secrets = new SecretsManagerClient(clientConfig(this.endpoint));
        const out = await secrets.send(
          new CreateSecretCommand({ Name: name, SecretString: value ?? '' }),
        );
        return { id: name, name, detail: out.ARN };
      }
    }
  }

  async remove(service: ServiceId, id: string): Promise<void> {
    switch (service) {
      case 's3': {
        const s3 = new S3Client({ ...clientConfig(this.endpoint), forcePathStyle: true });
        await s3.send(new DeleteBucketCommand({ Bucket: id }));
        return;
      }
      case 'sqs': {
        const sqs = new SQSClient(clientConfig(this.endpoint));
        const urlOut = await sqs.send(new GetQueueUrlCommand({ QueueName: id }));
        if (urlOut.QueueUrl) {
          await sqs.send(new DeleteQueueCommand({ QueueUrl: urlOut.QueueUrl }));
        }
        return;
      }
      case 'sns': {
        const sns = new SNSClient(clientConfig(this.endpoint));
        await sns.send(new DeleteTopicCommand({ TopicArn: id }));
        return;
      }
      case 'dynamodb': {
        const ddb = new DynamoDBClient(clientConfig(this.endpoint));
        await ddb.send(new DeleteTableCommand({ TableName: id }));
        return;
      }
      case 'ec2': {
        const ec2 = new EC2Client(clientConfig(this.endpoint));
        await ec2.send(new TerminateInstancesCommand({ InstanceIds: [id] }));
        return;
      }
      case 'secrets': {
        const secrets = new SecretsManagerClient(clientConfig(this.endpoint));
        await secrets.send(
          new DeleteSecretCommand({ SecretId: id, ForceDeleteWithoutRecovery: true }),
        );
        return;
      }
    }
  }
}

export function isServiceId(value: string): value is ServiceId {
  return (SERVICES as readonly string[]).includes(value);
}
