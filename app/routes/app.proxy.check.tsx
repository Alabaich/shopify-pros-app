import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  
  // 1. Get shop from URL as fallback (always present in proxy requests)
  const shopFallback = url.searchParams.get("shop");
  
  const { admin, session } = await authenticate.public.appProxy(request);

  if (!admin) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const customerId = url.searchParams.get("customerId");

  if (!customerId) {
    return Response.json({ isVip: false, message: "No customer ID provided" });
  }

  const customerGid = customerId.startsWith("gid://")
    ? customerId
    : `gid://shopify/Customer/${customerId}`;

  try {
    const response = await admin.graphql(
      `#graphql
      query getCustomerAndRules($id: ID!) {
        customer(id: $id) {
          id
          displayName
          email
          tags
          numberOfOrders
        }
        shop {
          metafield(namespace: "vip_pricing", key: "rules") {
            value
          }
        }
      }`,
      { variables: { id: customerGid } }
    );

    const responseJson = await response.json();
    const customer = responseJson.data?.customer;
    const rulesMetafield = responseJson.data?.shop?.metafield?.value;

    if (!customer) {
      return Response.json({ isVip: false, tags: [], ordersCount: "0" });
    }

    const tags: string[] = customer.tags || [];
    
    const rules = rulesMetafield ? JSON.parse(rulesMetafield) : [];
    const allowedTags = rules.map((r: any) => r.tag);

    const matchingTags = tags.filter(tag => allowedTags.includes(tag));
    const isVip = matchingTags.length > 0;
    
    const ordersCount = String(customer.numberOfOrders || "0");

    const finalShop = session?.shop || shopFallback;
    let dbStatus = "Skipped";

    if (finalShop && isVip) {
      try {
        await db.vipLoginLog.create({
          data: {
            shop: finalShop,
            customerId: customer.displayName || customerId,
            customerTag: matchingTags.join(", "),
            ordersCount: ordersCount
          }
        });
        dbStatus = "Saved";
      } catch (logError: unknown) {
        console.error("DB Log Error:", logError);
        dbStatus = "Error";
      }
    } else {
      dbStatus = isVip ? "Missing Shop" : "Not VIP";
    }

    return Response.json({
      isVip,
      tags,
      customerName: customer.displayName,
      ordersCount,
      debug: {
        shop: finalShop,
        dbStatus
      }
    });

  } catch (error) {
    console.error("Tags Check Failed:", error);
    return Response.json({ isVip: false, error: "Server Error" }, { status: 500 });
  }
};