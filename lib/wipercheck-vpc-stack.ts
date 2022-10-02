import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { IVpc, SubnetType, Vpc } from "aws-cdk-lib/aws-ec2";

export class WipercheckVpcStack extends cdk.Stack {
  readonly vpc: IVpc;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    this.vpc = new Vpc(this, "wipercheck-vpc", {
      vpcName: "wipercheck-vpc",
      cidr: "10.0.0.0/16",
      subnetConfiguration: [
        {
          cidrMask: 26,
          name: "private-data",
          subnetType: SubnetType.PRIVATE_WITH_NAT,
        },
        {
          cidrMask: 26,
          name: "public-data",
          subnetType: SubnetType.PUBLIC,
        },
      ],
      natGateways: 1,
    });
  }
}
