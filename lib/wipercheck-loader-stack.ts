import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { IVpc } from "aws-cdk-lib/aws-ec2";
import {
  Cluster,
  Compatibility,
  ContainerDefinition,
  ContainerImage,
  EnvironmentFile,
  LogDriver,
  NetworkMode,
  TaskDefinition,
} from "aws-cdk-lib/aws-ecs";
import { Bucket } from "aws-cdk-lib/aws-s3";
import {
  Effect,
  PolicyStatement,
  Role,
  ServicePrincipal,
} from "aws-cdk-lib/aws-iam";

interface WipercheckLoaderStackProps extends cdk.StackProps {
  vpc: IVpc;
}

export class WipercheckLoaderStack extends cdk.Stack {
  vpc: IVpc;
  loaderTask: TaskDefinition;
  loaderContainer: ContainerDefinition;
  cluster: Cluster;

  constructor(scope: Construct, id: string, props: WipercheckLoaderStackProps) {
    super(scope, id, props);
    this.vpc = props.vpc;

    const role = new Role(this, "wipercheck-role-loader", {
      roleName: "wipercheck-role-loader",
      assumedBy: new ServicePrincipal("ecs-tasks.amazonaws.com"),
      managedPolicies: [
        { managedPolicyArn: "arn:aws:iam::aws:policy/AmazonS3ReadOnlyAccess" },
        {
          managedPolicyArn:
            "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy",
        },
      ],
    });

    this.loaderTask = new TaskDefinition(
      this,
      "wipercheck-loader-task-definition",
      {
        compatibility: Compatibility.FARGATE,
        cpu: "256",
        executionRole: role,
        family: "wipercheck-loader-task-definition",
        memoryMiB: "512",
        networkMode: NetworkMode.AWS_VPC,
      }
    );

    this.loaderTask.addToTaskRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          "s3:Get*",
          "s3:List*",
          "s3-object-lambda:Get*",
          "s3-object-lambda:List*",
        ],
        resources: ["*"],
      })
    );

    const bucket = Bucket.fromBucketArn(
      this,
      "loader-secret-bucket",
      "arn:aws:s3:::wipercheck"
    );

    this.loaderContainer = this.loaderTask.addContainer(
      "wipercheck-loader-container",
      {
        containerName: "wipercheck-loader-container",
        environmentFiles: [EnvironmentFile.fromBucket(bucket, "loader.env")],
        image: ContainerImage.fromRegistry(
          "docker.io/evanhutnik/wipercheck-loader:latest"
        ),
        memoryLimitMiB: 512,
        logging: LogDriver.awsLogs({
          streamPrefix: "wipercheck-loader-logs",
        }),
        portMappings: [{ containerPort: 8080 }],
      }
    );

    this.cluster = new Cluster(this, "wipercheck-loader-cluster", {
      vpc: this.vpc,
      clusterName: "wipercheck-loader-cluster",
    });
  }
}
