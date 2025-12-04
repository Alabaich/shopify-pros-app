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
      query getCustomerInfo($id: ID!) {
        customer(id: $id) {
          id
          displayName
          email
          tags
          numberOfOrders
        }
      }`,
      { variables: { id: customerGid } }
    );

    const responseJson = await response.json();
    const customer = responseJson.data?.customer;

    if (!customer) {
      return Response.json({ isVip: false, tags: [], ordersCount: "0" });
    }

    const tags: string[] = customer.tags || [];
    const isVip = tags.includes("VIP");
    const ordersCount = String(customer.numberOfOrders || "0");

    const finalShop = session?.shop || shopFallback;
    let dbStatus = "Skipped";

    if (isVip && finalShop) {
        try {
          await db.vipLoginLog.create({
              data: {
                  shop: finalShop,
                  customerId: customer.displayName || customerId,
                  customerTag: tags.join(", "), 
                  ordersCount: ordersCount
              }
          });
          dbStatus = "Saved";
        } catch (logError: unknown) {
          dbStatus = "Error";
        }
    } else if (isVip && !finalShop) {
        dbStatus = "Missing Shop";
    }

    return Response.json({
      isVip,
      tags,
      customerName: customer.displayName,
      ordersCount,
      debug: {
        shop: finalShop,
        dbStatus,
        totalLogsInDb: totalLogs
      }
    });

  } catch (error) {
    console.error("Tags Check Failed:", error);
    return Response.json({ isVip: false, error: "Server Error" }, { status: 500 });
  }
};