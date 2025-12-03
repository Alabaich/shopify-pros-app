import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const loader = async ({ request }: any) => {
  const { session } = await authenticate.admin(request);
  const { shop } = session;

  try {
    const uniqueVips = await db.vipLoginLog.findMany({
      where: { shop },
      distinct: ["customerId"],
      select: { customerId: true },
    });

    const lastLog = await db.vipLoginLog.findFirst({
      where: { shop },
      orderBy: { timestamp: "desc" },
    });

    return {
      vipCount: uniqueVips.length,
      lastLogin: lastLog ? lastLog.timestamp : null,
    };
  } catch (error) {
    return { vipCount: 0, lastLogin: null };
  }
};

export default function Index() {
  const data = useLoaderData() as any;
  const { vipCount, lastLogin } = data || {};

  const styles = {
    container: {
      maxWidth: "800px",
      margin: "40px auto",
      fontFamily: '-apple-system, BlinkMacSystemFont, "San Francisco", "Segoe UI", Roboto, "Helvetica Neue", sans-serif',
      color: "#202223",
    },
    card: {
      backgroundColor: "#ffffff",
      borderRadius: "8px",
      boxShadow: "0 4px 6px rgba(0, 0, 0, 0.05), 0 1px 3px rgba(0,0,0,0.1)",
      padding: "24px",
      border: "1px solid #e1e3e5",
    },
    header: {
      marginBottom: "20px",
      borderBottom: "1px solid #e1e3e5",
      paddingBottom: "16px",
    },
    title: {
      fontSize: "20px",
      fontWeight: "600",
      margin: 0,
    },
    statRow: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      padding: "12px 0",
    },
    statLabel: {
      fontSize: "14px",
      color: "#6D7175",
      fontWeight: "500",
    },
    statValue: {
      fontSize: "24px",
      fontWeight: "600",
      color: "#008060",
    },
    dateValue: {
      fontSize: "16px",
      fontWeight: "500",
      color: "#202223",
    },
    badge: {
      display: "inline-block",
      padding: "4px 8px",
      borderRadius: "4px",
      backgroundColor: "#E4F5EB",
      color: "#008060",
      fontSize: "12px",
      fontWeight: "600",
      marginTop: "20px",
    },
  };

  return (
    <s-page>
    <div style={styles.container}>
      <div style={styles.card}>
        <div style={styles.header}>
          <h2 style={styles.title}>VIP Analytics</h2>
        </div>

        <div style={styles.statRow}>
          <span style={styles.statLabel}>Active VIP Users</span>
          <span style={styles.statValue}>{vipCount || 0}</span>
        </div>

        <div style={{ ...styles.statRow, borderTop: "1px solid #f1f2f3" }}>
          <span style={styles.statLabel}>Last VIP Login</span>
          <span style={styles.dateValue}>
            {lastLogin
              ? new Date(lastLogin).toLocaleString("en-US", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : "No logins yet"}
          </span>
        </div>

        <div style={styles.badge}>● System Operational</div>
      </div>
    </div>
    </s-page>
  );
}