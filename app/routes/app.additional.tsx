import { useLoaderData } from "react-router";
import {
  AppProvider,
  Page,
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
  const { session } = await authenticate.admin(request);
  const { shop } = session;

  try {
    const logs = await db.vipLoginLog.findMany({
      where: { shop },
      take: 250,
      orderBy: { timestamp: "desc" },
    });

    const uniqueCustomers = new Map();

    logs.forEach((log) => {
      // Use customerId (which stores the Name) as the unique key
      const key = log.customerId;
      
      // Since logs are sorted by date (desc), the first time we see a key, 
      // it is the latest entry. We skip duplicates found later.
      if (!uniqueCustomers.has(key)) {
        uniqueCustomers.set(key, {
          id: log.id.toString(),
          name: log.customerId,
          latestDate: log.timestamp,
          customerTag: log.customerTag || "",
          ordersCount: log.ordersCount || "0", 
        });
      }
    });

    const tableData = Array.from(uniqueCustomers.values());

    return { tableData };

  } catch (error) {
    console.error(error);
    return { tableData: [] };
  }
};

export default function AnalyticsPage() {
  const { tableData } = useLoaderData() as any;

  const resourceName = {
    singular: 'log',
    plural: 'logs',
  };

  const rowMarkup = tableData.map(
    ({ id, name, latestDate, customerTag, ordersCount }: any, index: number) => (
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
          {customerTag ? (
             <Badge tone="info">{customerTag}</Badge>
          ) : (
            <span style={{ color: "#bfbfbf" }}>-</span>
          )}
        </IndexTable.Cell>

        <IndexTable.Cell>
          <Text variant="bodyMd" as="span">
            {ordersCount}
          </Text>
        </IndexTable.Cell>
        
        <IndexTable.Cell>
          <div style={{ whiteSpace: 'nowrap' }}>
            <Text variant="bodyMd" as="span" tone="subdued">
              {new Date(latestDate).toLocaleString("en-US", {
                weekday: 'short',
                year: 'numeric',
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
              })}
            </Text>
          </div>
        </IndexTable.Cell>
      </IndexTable.Row>
    ),
  );

  return (
    <AppProvider i18n={enTranslations}>
      <Page title="VIP Access Logs" fullWidth>
        <LegacyCard>
          {tableData.length === 0 ? (
              <div style={{padding: '50px', textAlign: 'center'}}>
                  <Text as="p" tone="subdued" variant="bodyLg">No VIP users have logged in via the proxy yet.</Text>
              </div>
          ) : (
              <IndexTable
                resourceName={resourceName}
                itemCount={tableData.length}
                selectable={false}
                headings={[
                    { title: 'Customer' },
                    { title: 'Tags' },
                    { title: 'Orders' },
                    { title: 'Time' },
                ]}
              >
                {rowMarkup}
              </IndexTable>
          )}
        </LegacyCard>
      </Page>
    </AppProvider>
  );
}