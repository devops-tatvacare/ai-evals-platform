import { Card, MermaidDiagram, InfoBox, PageHeader } from "@/features/guide/components";
import { usePageExport } from "@/features/guide/hooks/usePageExport";

const authFlowDiagram = `sequenceDiagram
    participant U as User
    participant FE as Frontend
    participant BE as FastAPI
    participant DB as PostgreSQL

    Note over U,DB: Login Flow
    U->>FE: Email + Password
    FE->>BE: POST /api/auth/login
    BE->>DB: Lookup user (case-insensitive email)
    BE->>BE: Verify password (bcrypt)
    BE->>DB: Create RefreshToken
    BE-->>FE: accessToken (JWT) + Set-Cookie (refresh)
    FE->>FE: Store token in localStorage + authStore

    Note over U,DB: Token Refresh
    FE->>BE: POST /api/auth/refresh (cookie)
    BE->>DB: Validate + rotate RefreshToken
    BE-->>FE: New accessToken + rotated cookie

    Note over U,DB: Authenticated Request
    FE->>BE: GET /api/listings (Bearer token)
    BE->>BE: Decode JWT → AuthContext (tenant_id, user_id, role)
    BE->>DB: SELECT ... WHERE tenant_id = :tid`;

const inviteFlowDiagram = `flowchart TD
    Admin["Admin / Owner"] -->|"POST /api/admin/invite-links"| Create["Create Invite Link"]
    Create --> Token["Generate token + hash"]
    Token --> Link["Shareable URL: /signup?token=xxx"]
    Link --> NewUser["New user opens link"]
    NewUser -->|"GET /api/auth/validate-invite"| Validate["Validate token"]
    Validate --> Check{"Valid + not expired + uses remaining?"}
    Check -->|Yes| Form["Show signup form (tenant name, domain hint)"]
    Check -->|No| Reject["Show error (expired / exhausted)"]
    Form -->|"POST /api/auth/signup"| Signup["Create user + increment uses_count"]
    Signup --> Login["Auto-login → redirect to app"]

    style Admin fill:#6366f1,color:#fff
    style Create fill:#8b5cf6,color:#fff
    style Signup fill:#10b981,color:#fff
    style Reject fill:#ef4444,color:#fff`;

const tenantScopeDiagram = `flowchart LR
    Tenant["Tenant"] --> Users["Users (N)"]
    Tenant --> Config["TenantConfig (1)"]
    Tenant --> Invites["InviteLinks (N)"]
    Users --> Data["All Data Rows"]
    Data --> Listings["Listings"]
    Data --> EvalRuns["EvalRuns"]
    Data --> Jobs["Jobs"]
    Data --> Settings["Settings"]
    Data --> More["Prompts, Schemas, Evaluators, ..."]

    style Tenant fill:#6366f1,color:#fff
    style Users fill:#8b5cf6,color:#fff
    style Data fill:#f59e0b,color:#fff`;

const roles = [
  {
    role: "Owner",
    description:
      "Full access. Can manage all users, change roles, deactivate accounts, configure tenant settings. One per tenant (bootstrapped on first startup).",
    permissions: [
      "All admin operations",
      "Deactivate any user",
      "Change user roles",
      "Manage tenant config (branding, domains)",
      "Create invite links",
    ],
  },
  {
    role: "Admin",
    description:
      "Can manage users and invite links but cannot deactivate accounts or change the owner role.",
    permissions: [
      "Create/edit users",
      "Reset passwords",
      "Create invite links",
      "Manage invite links",
      "All evaluation operations",
    ],
  },
  {
    role: "Member",
    description:
      "Standard user. Full access to evaluation workflows (Voice RX, Kaira Bot) but no admin panel access.",
    permissions: [
      "Run evaluations",
      "Manage own listings/sessions",
      "View reports",
      "Change own password",
    ],
  },
];

const adminEndpoints = [
  { method: "GET", path: "/api/admin/users", description: "List all users in tenant" },
  { method: "POST", path: "/api/admin/users", description: "Create new user" },
  { method: "PATCH", path: "/api/admin/users/:id", description: "Update user (name, role, active)" },
  { method: "PUT", path: "/api/admin/users/:id/password", description: "Reset user password (revokes all sessions)" },
  { method: "DELETE", path: "/api/admin/users/:id", description: "Deactivate user (owner only)" },
  { method: "POST", path: "/api/admin/invite-links", description: "Create invite link (label, role, max uses, expiry)" },
  { method: "GET", path: "/api/admin/invite-links", description: "List all invite links" },
  { method: "DELETE", path: "/api/admin/invite-links/:id", description: "Revoke invite link" },
  { method: "GET", path: "/api/admin/tenant", description: "Get tenant details" },
  { method: "PATCH", path: "/api/admin/tenant", description: "Update tenant (name, slug)" },
  { method: "GET", path: "/api/admin/tenant-config", description: "Get tenant config (branding, domains)" },
  { method: "PATCH", path: "/api/admin/tenant-config", description: "Update tenant config" },
];

export default function UsersTenants() {
  const { contentRef } = usePageExport();

  return (
    <div
      ref={contentRef}
      className="page-content animate-fade-in-up"
      data-title="Users & Tenants"
    >
      <PageHeader
        title="Users & Tenant Management"
        subtitle="Multi-tenant authentication, user management, invite-based onboarding, and role-based access control."
        pageTitle="Users & Tenants"
        contentRef={contentRef}
      />

      {/* Multi-tenant Model */}
      <h2
        className="text-2xl font-bold mb-4"
        style={{ color: "var(--text)" }}
      >
        Multi-Tenant Data Model
      </h2>
      <Card className="mb-6">
        <p className="text-sm mb-3" style={{ color: "var(--text-secondary)" }}>
          Every data row belongs to a <strong>tenant</strong>. Every query
          filters by <code>tenant_id</code> from the authenticated user's
          JWT context. The <code>TenantUserMixin</code> adds
          both <code>tenant_id</code> and <code>user_id</code> as required
          foreign keys on all data models.
        </p>
        <MermaidDiagram chart={tenantScopeDiagram} />
      </Card>

      <InfoBox className="mb-8">
        <code>SYSTEM_TENANT_ID</code> and <code>SYSTEM_USER_ID</code> are
        well-known UUIDs for seed data (default prompts, schemas, evaluators).
        System resources are <strong>read-only</strong> to all tenants.
      </InfoBox>

      {/* Authentication Flow */}
      <h2
        className="text-2xl font-bold mb-4"
        style={{ color: "var(--text)" }}
      >
        Authentication Flow
      </h2>
      <Card className="mb-6">
        <p className="text-sm mb-3" style={{ color: "var(--text-secondary)" }}>
          JWT-based authentication with access + refresh token rotation.
          Access tokens are short-lived (stored in localStorage via{" "}
          <code>useAuthStore</code>). Refresh tokens use HTTP-only cookies
          with automatic rotation on each refresh call.
        </p>
        <table
          className="w-full text-sm mb-4"
          style={{ borderCollapse: "collapse" }}
        >
          <thead>
            <tr style={{ borderBottom: "2px solid var(--border)" }}>
              <th className="px-3 py-2 text-left font-semibold" style={{ color: "var(--text)" }}>Route</th>
              <th className="px-3 py-2 text-left font-semibold" style={{ color: "var(--text)" }}>Purpose</th>
              <th className="px-3 py-2 text-left font-semibold" style={{ color: "var(--text)" }}>Auth</th>
            </tr>
          </thead>
          <tbody>
            {[
              ["POST /api/auth/login", "Email + password login", "Public"],
              ["POST /api/auth/refresh", "Rotate tokens (cookie)", "Cookie"],
              ["POST /api/auth/logout", "Revoke refresh token", "Bearer"],
              ["GET /api/auth/me", "Get current user profile", "Bearer"],
              ["PUT /api/auth/me/password", "Change own password", "Bearer"],
              ["GET /api/auth/validate-invite", "Check invite token", "Public"],
              ["POST /api/auth/signup", "Register via invite", "Public"],
            ].map(([route, purpose, auth]) => (
              <tr key={route} style={{ borderBottom: "1px solid var(--border)" }}>
                <td className="px-3 py-2"><code className="text-xs">{route}</code></td>
                <td className="px-3 py-2" style={{ color: "var(--text-secondary)" }}>{purpose}</td>
                <td className="px-3 py-2">
                  <span
                    className="text-xs font-semibold px-2 py-0.5 rounded-full"
                    style={{
                      background: auth === "Public" ? "var(--bg-secondary)" : "var(--accent-surface)",
                      color: auth === "Public" ? "var(--text-secondary)" : "var(--accent-text)",
                    }}
                  >
                    {auth}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <MermaidDiagram chart={authFlowDiagram} />
      </Card>

      {/* Password Policy */}
      <h2
        className="text-2xl font-bold mb-4"
        style={{ color: "var(--text)" }}
      >
        Password Policy
      </h2>
      <Card className="mb-8">
        <ul className="list-disc list-inside text-sm" style={{ color: "var(--text-secondary)" }}>
          <li>Minimum 8 characters</li>
          <li>At least 1 uppercase letter</li>
          <li>At least 1 lowercase letter</li>
          <li>At least 1 digit</li>
          <li>At least 1 special character</li>
        </ul>
        <p className="text-sm mt-3" style={{ color: "var(--text-secondary)" }}>
          Frontend uses <code>PasswordStrengthIndicator</code> for real-time
          visual feedback. Backend enforces the same rules on{" "}
          <code>/signup</code> and <code>/me/password</code> routes.
          Changing a password <strong>revokes all refresh tokens</strong>{" "}
          (force re-login on other devices).
        </p>
      </Card>

      {/* Roles */}
      <h2
        className="text-2xl font-bold mb-4"
        style={{ color: "var(--text)" }}
      >
        Role-Based Access
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        {roles.map((r) => (
          <Card key={r.role}>
            <h3
              className="text-[1.0625rem] font-bold tracking-tight mb-2"
              style={{ color: "var(--text)" }}
            >
              {r.role}
            </h3>
            <p className="text-sm mb-3" style={{ color: "var(--text-secondary)" }}>
              {r.description}
            </p>
            <ul className="list-disc list-inside text-sm" style={{ color: "var(--text-secondary)" }}>
              {r.permissions.map((p) => (
                <li key={p} className="py-0.5">{p}</li>
              ))}
            </ul>
          </Card>
        ))}
      </div>

      <InfoBox className="mb-8">
        Frontend route guards: <code>AuthGuard</code> checks{" "}
        <code>isAuthenticated</code> for all protected routes.{" "}
        <code>AdminGuard</code> additionally checks that{" "}
        <code>role === &apos;admin&apos; || role === &apos;owner&apos;</code>{" "}
        for <code>/admin/*</code> routes.
      </InfoBox>

      {/* Invite-Based Onboarding */}
      <h2
        className="text-2xl font-bold mb-4"
        style={{ color: "var(--text)" }}
      >
        Invite-Based Onboarding
      </h2>
      <Card className="mb-6">
        <p className="text-sm mb-3" style={{ color: "var(--text-secondary)" }}>
          No public registration. New users join via <strong>invite links</strong>{" "}
          created by admins or owners. Each link can optionally enforce:
        </p>
        <ul className="list-disc list-inside text-sm mb-4" style={{ color: "var(--text-secondary)" }}>
          <li><strong>Max uses</strong> &mdash; limits how many signups can use the link</li>
          <li><strong>Expiry</strong> &mdash; 1 hour, 24 hours, 7 days, or 30 days</li>
          <li><strong>Default role</strong> &mdash; Member or Admin (assigned to new user)</li>
          <li><strong>Domain restrictions</strong> &mdash; via <code>TenantConfig.allowed_domains</code> (e.g., only <code>@company.com</code> emails)</li>
        </ul>
        <MermaidDiagram chart={inviteFlowDiagram} />
      </Card>

      {/* Admin Panel */}
      <h2
        className="text-2xl font-bold mb-4"
        style={{ color: "var(--text)" }}
      >
        Admin Panel
      </h2>
      <Card className="mb-6">
        <p className="text-sm mb-3" style={{ color: "var(--text-secondary)" }}>
          Accessible at <code>/admin/users</code> (admin and owner only).
          Tabbed interface with <strong>Users</strong> and{" "}
          <strong>Invite Links</strong> tabs.
        </p>
        <h4 className="text-sm font-semibold mb-2" style={{ color: "var(--text)" }}>
          User Management
        </h4>
        <ul className="list-disc list-inside text-sm mb-3" style={{ color: "var(--text-secondary)" }}>
          <li>Search users by name, email, or role</li>
          <li>Create new users with temporary passwords</li>
          <li>Edit display name and role</li>
          <li>Reset passwords (invalidates all active sessions)</li>
          <li>Deactivate accounts (owner only, cannot deactivate self or other owners)</li>
        </ul>
        <h4 className="text-sm font-semibold mb-2" style={{ color: "var(--text)" }}>
          Invite Link Management
        </h4>
        <ul className="list-disc list-inside text-sm mb-3" style={{ color: "var(--text-secondary)" }}>
          <li>Create links with label, role, max uses, and expiry</li>
          <li>Copy shareable URL to clipboard</li>
          <li>View status: active, expired, exhausted, revoked</li>
          <li>Revoke active links</li>
        </ul>
        <h4 className="text-sm font-semibold mb-2" style={{ color: "var(--text)" }}>
          Tenant Configuration
        </h4>
        <ul className="list-disc list-inside text-sm" style={{ color: "var(--text-secondary)" }}>
          <li>Update tenant name and slug</li>
          <li>Set allowed email domains for signup restrictions</li>
          <li>Configure app URL and logo URL (branding)</li>
        </ul>
      </Card>

      {/* Admin API Reference */}
      <h2
        className="text-2xl font-bold mb-4"
        style={{ color: "var(--text)" }}
      >
        Admin API Reference
      </h2>
      <Card>
        <div className="overflow-x-auto">
          <table
            className="w-full text-sm"
            style={{ borderCollapse: "collapse" }}
          >
            <thead>
              <tr style={{ borderBottom: "2px solid var(--border)" }}>
                <th className="px-3 py-2 text-left font-semibold" style={{ color: "var(--text)", width: "80px" }}>Method</th>
                <th className="px-3 py-2 text-left font-semibold" style={{ color: "var(--text)" }}>Endpoint</th>
                <th className="px-3 py-2 text-left font-semibold" style={{ color: "var(--text)" }}>Description</th>
              </tr>
            </thead>
            <tbody>
              {adminEndpoints.map((ep) => (
                <tr key={`${ep.method}-${ep.path}`} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td className="px-3 py-2">
                    <span
                      className="text-xs font-bold px-2 py-0.5 rounded"
                      style={{
                        background:
                          ep.method === "GET" ? "var(--color-http-get)" :
                          ep.method === "POST" ? "var(--color-http-post)" :
                          ep.method === "PATCH" ? "var(--color-http-patch)" :
                          ep.method === "PUT" ? "var(--color-http-put)" :
                          "var(--color-http-delete)",
                        color: "var(--text-on-color)",
                      }}
                    >
                      {ep.method}
                    </span>
                  </td>
                  <td className="px-3 py-2"><code className="text-xs">{ep.path}</code></td>
                  <td className="px-3 py-2" style={{ color: "var(--text-secondary)" }}>{ep.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
