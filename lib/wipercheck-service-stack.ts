import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import {
  IVpc,
  Peer,
  Port,
  SecurityGroup,
  SubnetType,
  Vpc,
} from "aws-cdk-lib/aws-ec2";
import {
  ApplicationListener,
  ApplicationLoadBalancer,
  ApplicationProtocol,
  ApplicationTargetGroup,
  TargetType,
} from "aws-cdk-lib/aws-elasticloadbalancingv2";
import { Duration } from "aws-cdk-lib";
import {
  Cluster,
  Compatibility,
  ContainerDefinition,
  ContainerImage,
  EnvironmentFile,
  FargateService,
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

interface WipercheckServiceStackProps extends cdk.StackProps {
  vpc: IVpc;
}

export class WipercheckServiceStack extends cdk.Stack {
  vpc: IVpc;
  loadBalancer: ApplicationLoadBalancer;
  applicationTargetGroup: ApplicationTargetGroup;
  loadBalancerListener: ApplicationListener;
  serviceTask: TaskDefinition;
  serviceContainer: ContainerDefinition;
  cluster: Cluster;
  service: FargateService;

  constructor(
    scope: Construct,
    id: string,
    props: WipercheckServiceStackProps
  ) {
    super(scope, id, props);
    this.vpc = props.vpc;

    this.loadBalancer = new ApplicationLoadBalancer(
      this,
      "wipercheck-service-load-balancer",
      {
        vpc: this.vpc,
        vpcSubnets: { subnets: this.vpc.publicSubnets },
        internetFacing: true,
        loadBalancerName: "wipercheck-service-lb",
      }
    );

    this.loadBalancerListener = this.loadBalancer.addListener(
      "wipercheck-service-lb-listener",
      {
        port: 80,
        open: true,
        protocol: ApplicationProtocol.HTTP,
      }
    );

    this.applicationTargetGroup = new ApplicationTargetGroup(
      this,
      "wipercheck-service-application-tg",
      {
        targetGroupName: "wipercheck-service-tg",
        vpc: this.vpc,
        protocol: ApplicationProtocol.HTTP,
        targetType: TargetType.IP,
        port: 80,
        healthCheck: {
          healthyThresholdCount: 2,
          path: "/health",
          interval: Duration.seconds(5),
          timeout: Duration.seconds(2),
        },
        deregistrationDelay: Duration.seconds(10),
      }
    );

    this.loadBalancerListener.addTargetGroups(
      "wipercheck-service-lb-listener-tg",
      {
        targetGroups: [this.applicationTargetGroup],
      }
    );

    const role = new Role(this, "wipercheck-role-service", {
      roleName: "wipercheck-role-service",
      assumedBy: new ServicePrincipal("ecs-tasks.amazonaws.com"),
      managedPolicies: [
        { managedPolicyArn: "arn:aws:iam::aws:policy/AmazonS3ReadOnlyAccess" },
        {
          managedPolicyArn:
            "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy",
        },
      ],
    });

    this.serviceTask = new TaskDefinition(
      this,
      "wipercheck-service-task-definition",
      {
        compatibility: Compatibility.FARGATE,
        cpu: "256",
        executionRole: role,
        memoryMiB: "512",
        networkMode: NetworkMode.AWS_VPC,
      }
    );
    this.serviceTask.addToTaskRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          "s3:Get*",
          "s3:List*",
          "s3-object-lambda:Get*",
          "s3-object-lambda:List*",
        ],
        resources: [`arn:aws:s3:::wipercheck`],
      })
    );

    const bucket = Bucket.fromBucketArn(
      this,
      "service-secret-bucket",
      "arn:aws:s3:::wipercheck"
    );

    this.serviceContainer = this.serviceTask.addContainer(
      "wipercheck-service-container",
      {
        containerName: "wipercheck-service-container",
        environmentFiles: [EnvironmentFile.fromBucket(bucket, "service.env")],
        image: ContainerImage.fromRegistry(
          "docker.io/evanhutnik/wipercheck-service:latest"
        ),
        memoryLimitMiB: 512,
        logging: LogDriver.awsLogs({
          streamPrefix: "wipercheck-service-logs",
        }),
        portMappings: [{ containerPort: 8080 }],
      }
    );

    this.serviceContainer.addPortMappings({ containerPort: 80 }); // Default protocol is TCP

    this.cluster = new Cluster(this, "wipercheck-service-cluster", {
      vpc: this.vpc,
      clusterName: "wipercheck-service-cluster",
    });

    const ecsSecGroup = new SecurityGroup(
      this,
      "wipercheck-ecs-security-group",
      {
        securityGroupName: "wipercheck-ecs-security-group",
        vpc: this.vpc,
        allowAllOutbound: true,
      }
    );

    ecsSecGroup.addIngressRule(
      Peer.anyIpv4(),
      Port.tcp(80),
      "Allow all HTTP traffic"
    );

    this.service = new FargateService(this, "wipercheck-service", {
      serviceName: "wipercheck-service",
      cluster: this.cluster,
      desiredCount: 1,
      taskDefinition: this.serviceTask,
      securityGroups: [ecsSecGroup],
      assignPublicIp: true,
    });

    this.service.attachToApplicationTargetGroup(this.applicationTargetGroup);

    const serviceScaling = this.service.autoScaleTaskCount({
      minCapacity: 1,
      maxCapacity: 5,
    });

    serviceScaling.scaleOnMemoryUtilization("ecs-scale-mem", {
      targetUtilizationPercent: 75,
    });

    serviceScaling.scaleOnCpuUtilization("ecs-scale-cpu", {
      targetUtilizationPercent: 75,
    });
  }
}
