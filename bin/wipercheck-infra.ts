#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { WipercheckVpcStack } from "../lib/wipercheck-vpc-stack";
import { WipercheckServiceStack } from "../lib/wipercheck-service-stack";
import { WipercheckLoaderStack } from "../lib/wipercheck-loader-stack";

const app = new cdk.App();
const env = {
  account: "384380898029",
  region: "us-east-1",
};
const vpcStack = new WipercheckVpcStack(app, "WipercheckVpcStack", {
  env,
});

new WipercheckServiceStack(app, "WipercheckServiceStack", {
  env,
  vpc: vpcStack.vpc,
});

new WipercheckLoaderStack(app, "WipercheckLoaderStack", {
  env,
  vpc: vpcStack.vpc,
});
