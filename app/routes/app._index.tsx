import { useState, useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useNavigation } from "react-router";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();

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

  return {
    status: "success",
    segmentName: segmentJson.data.segmentCreate.segment.name,
    discountTitle: discountJson.data.discountAutomaticBasicCreate.automaticDiscountNode.automaticDiscount.title
  };
};

export default function Index() {
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  const isLoading = nav.state === "submitting";

  const [tag, setTag] = useState("VIP");
  const [percentage, setPercentage] = useState("10");

  useEffect(() => {
    if (actionData?.status === "success") {
      shopify.toast.show(`Created ${actionData.discountTitle}`);
    } else if (actionData?.status === "fail") {
      shopify.toast.show(actionData.error, { isError: true });
    }
  }, [actionData]);

  return (
    <s-page title="Automatic Discount Generator">
      {actionData?.status === "success" && (
        <s-banner tone="success" title="Success">
          Discount created successfully! You can verify it in the <a href="shopify:admin/discounts" target="_blank">Discounts</a> section.
        </s-banner>
      )}

      <s-section>
        <s-stack gap="500">
          <p>Create a native Shopify discount for your Proxy login users.</p>

          <Form method="post">
            <s-stack gap="400">
              <s-text-field
                label="Customer Tag"
                name="tag"
                value={tag}
                onInput={(e: any) => setTag(e.target.value)}
              />

              <s-text-field
                label="Discount Percentage"
                type="number"
                name="percentage"
                value={percentage}
                onInput={(e: any) => setPercentage(e.target.value)}
              />

              <input
                type="hidden"
                name="title"
                value={`${tag} Automatic ${percentage}% Off`}
              />

              <s-button
                type="submit"
                variant="primary"
                loading={isLoading ? "true" : undefined}
              >
                Create Native Discount
              </s-button>
            </s-stack>
          </Form>
        </s-stack>
      </s-section>
    </s-page>
  );
}