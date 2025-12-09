import { useState, useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs, LinksFunction } from "react-router";
import { Form, useActionData, useNavigation, useLoaderData, useSubmit } from "react-router";
import {
  AppProvider,
  Page,
  Layout,
  Card,
  TextField,
  Button,
  BlockStack,
  Text,
  IndexTable,
  InlineStack,
  Banner
} from "@shopify/polaris";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import enTranslations from "@shopify/polaris/locales/en.json";
import { authenticate } from "../shopify.server";

export const links: LinksFunction = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  const response = await admin.graphql(
    `#graphql
    query GetVipRules {
      shop {
        metafield(namespace: "vip_pricing", key: "rules") {
          value
        }
      }
    }`
  );

  const json = await response.json();
  const rawRules = json.data.shop.metafield?.value;
  const rules = rawRules ? JSON.parse(rawRules) : [];

  return { rules };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "delete") {
    const discountId = String(formData.get("discountId"));
    const segmentId = String(formData.get("segmentId"));

    if (discountId) {
      await admin.graphql(
        `#graphql
        mutation DeleteDiscount($id: ID!) {
          discountAutomaticDelete(id: $id) {
            userErrors {
              field
              message
            }
          }
        }`,
        { variables: { id: discountId } }
      );
    }

    if (segmentId) {
      await admin.graphql(
        `#graphql
        mutation DeleteSegment($id: ID!) {
          segmentDelete(id: $id) {
            userErrors {
              field
              message
            }
          }
        }`,
        { variables: { id: segmentId } }
      );
    }

    const currentMetafield = await admin.graphql(
      `#graphql
      query GetRules {
        shop {
          metafield(namespace: "vip_pricing", key: "rules") {
            value
          }
        }
      }`
    );

    const currentJson = await currentMetafield.json();
    const rawVal = currentJson.data.shop.metafield?.value;
    let existingRules = rawVal ? JSON.parse(rawVal) : [];

    existingRules = existingRules.filter((r: any) => r.discountId !== discountId);

    await admin.graphql(
      `#graphql
      mutation UpdateRules($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          userErrors {
            field
            message
          }
        }
      }`,
      {
        variables: {
          metafields: [
            {
              namespace: "vip_pricing",
              key: "rules",
              type: "json",
              ownerId: (await admin.graphql(`{ shop { id } }`).then(r => r.json())).data.shop.id,
              value: JSON.stringify(existingRules)
            }
          ]
        }
      }
    );

    return { status: "deleted" };
  }

  const tagToTarget = String(formData.get("tag"));
  const discountTitle = String(formData.get("title"));
  const percentageRaw = parseFloat(String(formData.get("percentage") || "0"));
  const percentageValue = percentageRaw / 100;

  if (!tagToTarget) {
    return { status: "fail", error: "Missing Tag" };
  }

  const segmentQuery = `customer_tags CONTAINS '${tagToTarget}'`;

  const segmentResponse = await admin.graphql(
    `#graphql
    mutation CreateSegment($name: String!, $query: String!) {
      segmentCreate(name: $name, query: $query) {
        segment {
          id
          name
        }
        userErrors {
          field
          message
        }
      }
    }`,
    {
      variables: {
        name: `${tagToTarget} Users`,
        query: segmentQuery
      }
    }
  );

  const segmentJson = await segmentResponse.json();
  const segmentErrors = segmentJson.data.segmentCreate.userErrors;

  if (segmentErrors.length > 0) {
    return { status: "fail", error: `Segment Error: ${segmentErrors[0].message}` };
  }

  const newSegmentId = segmentJson.data.segmentCreate.segment.id;

  const discountResponse = await admin.graphql(
    `#graphql
    mutation CreateNativeDiscount($discount: DiscountAutomaticBasicInput!) {
      discountAutomaticBasicCreate(automaticBasicDiscount: $discount) {
        automaticDiscountNode {
          id
          automaticDiscount {
            ... on DiscountAutomaticBasic {
              title
              status
            }
          }
        }
        userErrors {
          field
          message
        }
      }
    }`,
    {
      variables: {
        discount: {
          title: discountTitle,
          startsAt: new Date().toISOString(),
          context: {
            customerSegments: {
              add: [newSegmentId]
            }
          },
          customerGets: {
            value: {
              percentage: percentageValue
            },
            items: {
              all: true
            }
          }
        }
      }
    }
  );

  const discountJson = await discountResponse.json();
  const discountErrors = discountJson.data.discountAutomaticBasicCreate.userErrors;

  if (discountErrors.length > 0) {
    return { status: "fail", error: `Discount Error: ${discountErrors[0].message}` };
  }

  const newDiscountId = discountJson.data.discountAutomaticBasicCreate.automaticDiscountNode.id;

  const currentMetafield = await admin.graphql(
    `#graphql
    query GetRules {
      shop {
        id
        metafield(namespace: "vip_pricing", key: "rules") {
          value
        }
      }
    }`
  );

  const currentJson = await currentMetafield.json();
  const shopId = currentJson.data.shop.id;
  const rawVal = currentJson.data.shop.metafield?.value;
  const existingRules = rawVal ? JSON.parse(rawVal) : [];

  existingRules.push({
    tag: tagToTarget,
    percentage: percentageRaw,
    discountId: newDiscountId,
    segmentId: newSegmentId,
    title: discountTitle
  });

  await admin.graphql(
    `#graphql
    mutation UpdateRules($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        userErrors {
          field
          message
        }
      }
    }`,
    {
      variables: {
        metafields: [
          {
            namespace: "vip_pricing",
            key: "rules",
            type: "json",
            ownerId: shopId,
            value: JSON.stringify(existingRules)
          }
        ]
      }
    }
  );

  return {
    status: "success",
    segmentName: segmentJson.data.segmentCreate.segment.name,
    discountTitle: discountJson.data.discountAutomaticBasicCreate.automaticDiscountNode.automaticDiscount.title
  };
};

export default function Index() {
  const { rules } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  const submit = useSubmit();
  const isLoading = nav.state === "submitting";

  const [tag, setTag] = useState("VIP");
  const [percentage, setPercentage] = useState("10");

  useEffect(() => {
    if (actionData?.status === "success") {
      shopify.toast.show(`Created ${actionData.discountTitle}`);
    } else if (actionData?.status === "deleted") {
      shopify.toast.show("Discount deleted");
    } else if (actionData?.status === "fail") {
      shopify.toast.show(actionData.error, { isError: true });
    }
  }, [actionData]);

  const handleDelete = (discountId: string, segmentId: string) => {
    submit({ intent: "delete", discountId, segmentId }, { method: "post" });
  };

  const rowMarkup = rules.map(
    (rule: any, index: number) => (
      <IndexTable.Row id={rule.discountId} key={rule.discountId} position={index}>
        <IndexTable.Cell>
          <Text variant="bodyMd" fontWeight="bold" as="span">
            {rule.tag}
          </Text>
        </IndexTable.Cell>
        <IndexTable.Cell>{rule.percentage}%</IndexTable.Cell>
        <IndexTable.Cell>{rule.title}</IndexTable.Cell>
        <IndexTable.Cell>
          <Button
            tone="critical"
            variant="plain"
            onClick={() => handleDelete(rule.discountId, rule.segmentId)}
            disabled={isLoading}
          >
            Delete
          </Button>
        </IndexTable.Cell>
      </IndexTable.Row>
    ),
  );

  return (
    <AppProvider i18n={enTranslations}>
      <Page title="VIP Pricing Rules" subtitle="Manage automatic discounts based on customer tags">
        <Layout>
          <Layout.Section variant="oneThird">
            <Card>
              <Form method="post">
                <input type="hidden" name="intent" value="create" />
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">
                    Create Rule
                  </Text>
                  <Text as="p" tone="subdued">
                    Define a tag and discount percentage. This will create a Customer Segment and an Automatic Discount.
                  </Text>
                  <TextField
                    label="Customer Tag"
                    name="tag"
                    value={tag}
                    onChange={(value) => setTag(value)}
                    placeholder="e.g. Gold"
                    autoComplete="off"
                  />
                  <TextField
                    label="Discount Percentage"
                    type="number"
                    name="percentage"
                    value={percentage}
                    onChange={(value) => setPercentage(value)}
                    suffix="%"
                    autoComplete="off"
                  />
                  <input
                    type="hidden"
                    name="title"
                    value={`${tag} Automatic ${percentage}% Off`}
                  />
                  <Button
                    submit
                    variant="primary"
                    loading={isLoading}
                    fullWidth
                  >
                    Create Native Discount
                  </Button>
                </BlockStack>
              </Form>
            </Card>
          </Layout.Section>

          <Layout.Section>
            <Card padding="0">
              {rules.length === 0 ? (
                <BlockStack align="center" inlineAlign="center" gap="400" padding="400">
                  <Text as="p" fontWeight="bold">No active rules found</Text>
                  <Text as="p" tone="subdued">Create a new rule to start offering VIP discounts.</Text>
                </BlockStack>
              ) : (
                <IndexTable
                  resourceName={{ singular: 'discount', plural: 'discounts' }}
                  itemCount={rules.length}
                  headings={[
                    { title: 'Tag' },
                    { title: 'Percentage' },
                    { title: 'Title' },
                    { title: 'Action' },
                  ]}
                  selectable={false}
                >
                  {rowMarkup}
                </IndexTable>
              )}
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    </AppProvider>
  );
}