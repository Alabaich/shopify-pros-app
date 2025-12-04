import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.public.appProxy(request);

  if (!admin) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const customerId = url.searchParams.get("customerId");
  const shop = url.searchParams.get("shop");

  if (!customerId) {
    return Response.json({ isVip: false, message: "No customer ID provided" });
  }

  const customerGid = customerId.startsWith("gid://") 
    ? customerId 
    : `gid://shopify/Customer/${customerId}`;

  try {
    // FIXED QUERY: using 'numberOfOrders' instead of 'ordersCount'
    const response = await admin.graphql(
      `#graphql
      query getCustomerTags($id: ID!) {
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
      return Response.json({ isVip: false, tags: [] });
    }

    const tags: string[] = customer.tags || [];
    const isVip = tags.includes("VIP");

    // Use numberOfOrders directly
    const ordersCount = Number(customer.numberOfOrders) || 0;

    if (shop) {
        try {
          await db.vipLoginLog.create({
              data: {
                  shop: shop,
                  customerId: customer.id, // Saving ID, not Name
                  customerTag: tags.join(", "),
                  ordersCount: ordersCount
              }
          });
        } catch (logError: unknown) {
          console.error("Failed to log access", logError);
        }
    }

    return Response.json({
      isVip,
      tags,
      customerName: customer.displayName
    });

  } catch (error) {
    console.error("Tag Check Failed:", error);
    return Response.json({ isVip: false, error: "Server Error" }, { status: 500 });
  }
};