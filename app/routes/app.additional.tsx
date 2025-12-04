import { useLoaderData } from "react-router";
import {
  AppProvider,
  Page,
  Layout,
  LegacyCard,
  IndexTable,
  Text,
  Badge,
} from "@shopify/polaris";
import enTranslations from "@shopify/polaris/locales/en.json";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";

export const links = () => [
  { rel: "stylesheet", href: polarisStyles },
];

export const loader = async ({ request }: any) => {
  const { session, admin } = await authenticate.admin(request);
  const { shop } = session;

  try {
    const logs = await db.vipLoginLog.findMany({
      where: { shop },
      take: 50,
      orderBy: { timestamp: "desc" },
    });

    // Robust ID extraction: "gid://shopify/Customer/12345" -> "12345"
    const uniqueNumericIds = [...new Set(logs.map((l) => {
      const idStr = String(l.customerId);
      const match = idStr.match(/\d+/);
      return match ? match[0] : null;
    }))].filter(Boolean);
    
    // Create GIDs for the query
    const queryIds = uniqueNumericIds.map(id => `gid://shopify/Customer/${id}`);
    
    console.log("[DEBUG] Querying IDs:", queryIds);

    let shopifyCustomersMap: Record<string, any> = {};

    if (queryIds.length > 0) {
      try {
        // FIXED QUERY: using 'numberOfOrders' instead of 'ordersCount'
        // 'ordersCount' was removed in API 2025-10
        const response = await admin.graphql(
          `#graphql
          query getCustomers($ids: [ID!]!) {
            nodes(ids: $ids) {
              ... on Customer {
                id
                displayName
                numberOfOrders
                orders(first: 1) {
                  totalCount
                }
              }
            }
          }`,
          {
            variables: {
              ids: queryIds,
            },
          }
        );

        const responseJson = await response.json();
        console.log("[DEBUG] Raw Shopify Response:", JSON.stringify(responseJson));

        if (responseJson.data?.nodes) {
          responseJson.data.nodes.forEach((node: any) => {
            if (node && node.id) {
              const numericId = node.id.split("/").pop();
              shopifyCustomersMap[numericId] = node;
            }
          });
        }
      } catch (apiError) {
        console.error("Shopify API Error:", apiError);
      }
    }

    const groupedData: Record<string, any> = {};

    logs.forEach((log) => {
      const { customerId, timestamp, customerTag, id, ordersCount } = log;
      
      const dbNumericId = String(customerId).match(/\d+/)?.[0];
      const freshData = dbNumericId ? shopifyCustomersMap[dbNumericId] : null;
      
      let displayOrdersCount = 0;
      let displayName = customerId;

      if (freshData) {
        displayName = freshData.displayName;
        
        // Priority 1: numberOfOrders (Direct field replacement)
        // Priority 2: orders.totalCount (Connection count)
        const directCount = Number(freshData.numberOfOrders) || 0;
        const connectionCount = freshData.orders?.totalCount || 0;
        
        displayOrdersCount = Math.max(directCount, connectionCount);
      } else {
        displayOrdersCount = ordersCount ?? 0;
      }

      if (!groupedData[customerId]) {
        groupedData[customerId] = {
          id: id.toString(),
          name: displayName,
          latestDate: timestamp,
          customerTag: customerTag || "",
          loginCount: 0,
          ordersCount: displayOrdersCount,
        };
      }
      
      groupedData[customerId].loginCount += 1;
    });

    const tableData = Object.values(groupedData);

    return { tableData };

  } catch (error) {
    console.error(error);
    return { tableData: [] };
  }
};

export default function AnalyticsPage() {
  const { tableData } = useLoaderData() as any;

  const resourceName = {
    singular: 'customer',
    plural: 'customers',
  };

  const rowMarkup = tableData.map(
    ({ id, name, latestDate, loginCount, customerTag, ordersCount }: any, index: number) => (
      <IndexTable.Row
        id={id}
        key={id}
        position={index}
      >
        <IndexTable.Cell>
          <Text variant="bodyMd" fontWeight="bold" as="span">
            {name}
          </Text>
        </IndexTable.Cell>
        
        <IndexTable.Cell>
          <div style={{ whiteSpace: 'nowrap' }}>
            <Text variant="bodyMd" as="span">
              {new Date(latestDate).toLocaleString("en-US", {
                month: "short", day: "numeric", hour: "2-digit", minute: "2-digit"
              })}
            </Text>
          </div>
        </IndexTable.Cell>

        <IndexTable.Cell>
          <Text variant="bodyMd" as="span">
            {loginCount}
          </Text>
        </IndexTable.Cell>

        <IndexTable.Cell>
          <Text variant="bodyMd" as="span">
            {ordersCount}
          </Text>
        </IndexTable.Cell>
        
        <IndexTable.Cell>
          <Badge tone="success">Active</Badge>
        </IndexTable.Cell>
        
        <IndexTable.Cell>
          {customerTag ? <Badge>{customerTag}</Badge> : '-'}
        </IndexTable.Cell>
      </IndexTable.Row>
    ),
  );

  return (
    <AppProvider i18n={enTranslations}>
      <Page title="Customer Login History">
        <Layout>
          <Layout.Section>
            <LegacyCard>
              {tableData.length === 0 ? (
                  <div style={{padding: '30px', textAlign: 'center'}}>
                      <Text as="p" tone="subdued">No data yet. Log in to your store front to see records here.</Text>
                  </div>
              ) : (
                  <IndexTable
                    resourceName={resourceName}
                    itemCount={tableData.length}
                    selectable={false}
                    condensed={false}
                    headings={[
                        { title: 'Customer' },
                        { title: 'Last Login' },
                        { title: 'Total Sessions' },
                        { title: 'Orders' },
                        { title: 'Status' },
                        { title: 'Tag' },
                    ]}
                  >
                    {rowMarkup}
                  </IndexTable>
              )}
            </LegacyCard>
          </Layout.Section>
        </Layout>
      </Page>
    </AppProvider>
  );
}