import * as pulumi from "@pulumi/pulumi";
import * as hookdeck from "@pulumi/hookdeck";

// NOTE: @pulumi/hookdeck may need to be vendored locally if not yet published
// on npm in the version pinned here. If you hit install issues, switch the
// dependency in package.json to a `file:` path pointing at the vendored SDK.

const config = new pulumi.Config();
const destinationUrl = config.require("destinationUrl");

const projectName = "{{projectName}}";

const source = new hookdeck.Source(`${projectName}-source`, {
  name: `${projectName}-source`,
  type: "GENERIC",
});

const destination = new hookdeck.Destination(`${projectName}-destination`, {
  name: `${projectName}-destination`,
  type: "HTTP",
  config: {
    url: destinationUrl,
  },
});

const connection = new hookdeck.Connection(`${projectName}-connection`, {
  name: `${projectName}-connection`,
  sourceId: source.id,
  destinationId: destination.id,
});

export const sourceId = source.id;
export const sourceUrl = source.url;
export const destinationId = destination.id;
export const connectionId = connection.id;
