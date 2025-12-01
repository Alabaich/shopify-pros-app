import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.public.appProxy(request);

  if (!admin) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
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
      query getCustomerTags($id: ID!) {
        customer(id: $id) {
          id
          displayName
          email
          tags
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

    // --- LOGGING LOGIC ---
    // If they are VIP, log this event to the database
    if (isVip && session?.shop) {
        // We use a try/catch here to ensure logging failure doesn't break the user experience
        try {
          await db.vipLoginLog.create({
              data: {
                  shop: session.shop,
                  customerId: customer.displayName || customerId,
              }
          });
        } catch (logError: unknown) {
          // Fix: Type the error as unknown or explicitly cast it
          console.error("Failed to log VIP access", logError);
        }
    }
    // ---------------------

    return Response.json({
      isVip,
      tags,
      customerName: customer.displayName
    });

  } catch (error) {
    console.error("VIP Check Failed:", error);
    return Response.json({ isVip: false, error: "Server Error" }, { status: 500 });
  }
};