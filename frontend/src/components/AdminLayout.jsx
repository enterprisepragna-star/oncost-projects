import React, { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { ADMIN, AUTH } from "@/constants/testIds";
import { Boxes, Package, Receipt, Settings2, LogOut, PlusSquare, Layers, Menu, X, CheckCircle2, FolderTree, Percent, UserPlus, Handshake, Coins, Wallet, Sparkles } from "lucide-react";

const NavItem = ({ to, label, icon: Icon, testid, onClick }) => {
  const loc = useLocation();
  const active = loc.pathname === to || loc.pathname.startsWith(to + "/");
  return (
    <Link
      to={to}
      onClick={onClick}
      data-testid={testid}
      className={`group flex items-center gap-3 px-4 py-3 border-l-2 transition-all ${
        active
          ? "bg-[#002FA7] text-white border-[#FF3B30]"
          : "border-transparent text-zinc-700 hover:bg-zinc-100 hover:text-zinc-900"
      }`}
    >
      <Icon size={16} strokeWidth={active ? 2.4 : 1.6} />
      <span className="text-sm font-medium tracking-tight">{label}</span>
    </Link>
  );
};

export default function AdminLayout({ children }) {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const onLogout = async () => {
    await logout();
    nav("/login");
  };
  const closeMobile = () => setMobileOpen(false);

  const sidebar = (
    <>
      <div className="px-5 py-6 border-b border-zinc-200 flex items-center justify-between">
        <Link to="/admin" onClick={closeMobile} className="flex items-baseline gap-2">
          <span className="logo-mark text-2xl">ONCOST</span>
          <span className="overline text-[10px]">Admin</span>
        </Link>
        <button onClick={closeMobile} className="lg:hidden p-2 hover:bg-zinc-100" aria-label="Close menu">
          <X size={16} />
        </button>
      </div>
      <p className="px-5 py-2 tag-strip">Catalog Console v1</p>
      <nav className="flex-1 py-3">
        <p className="overline px-5 mb-2">Catalog</p>
        <NavItem to="/admin/products" label="Products" icon={Package} testid={ADMIN.navProducts} onClick={closeMobile} />
        <NavItem to="/admin/categories" label="Categories" icon={FolderTree} testid="nav-categories" onClick={closeMobile} />
        <NavItem to="/admin/pricing-rule" label="Pricing Rules" icon={Settings2} testid={ADMIN.navPricing} onClick={closeMobile} />
        <NavItem to="/admin/discount" label="Discount" icon={Percent} testid="nav-discount" onClick={closeMobile} />

        <p className="overline px-5 mt-6 mb-2">Sales</p>
        <NavItem to="/admin/quotations/new" label="New Quotation" icon={PlusSquare} testid={ADMIN.navNewQuote} onClick={closeMobile} />
        <NavItem to="/admin/quotations" label="Quotations" icon={Receipt} testid={ADMIN.navQuotations} onClick={closeMobile} />
        <NavItem to="/admin/sales" label="Accepted Sales" icon={CheckCircle2} testid="nav-sales" onClick={closeMobile} />

        <p className="overline px-5 mt-6 mb-2">OPMS · Partner Mgmt</p>
        <NavItem to="/admin/opms/partners" label="Partners" icon={UserPlus} testid="nav-partners" onClick={closeMobile} />
        <NavItem to="/admin/opms/leads" label="Leads" icon={Handshake} testid="nav-leads" onClick={closeMobile} />
        <NavItem to="/admin/opms/commission-rules" label="Commission Rules" icon={Percent} testid="nav-commission-rules" onClick={closeMobile} />
        <NavItem to="/admin/opms/commissions" label="Payout Tracker" icon={Wallet} testid="nav-commissions" onClick={closeMobile} />
        <NavItem to="/admin/opms/incentives" label="Incentives" icon={Sparkles} testid="nav-incentives" onClick={closeMobile} />

        <p className="overline px-5 mt-6 mb-2">Public</p>
        <NavItem to="/catalog" label="View Catalog" icon={Boxes} testid="nav-public-catalog" onClick={closeMobile} />
      </nav>
      <div className="border-t border-zinc-200 p-4">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-8 h-8 bg-[#002FA7] text-white flex items-center justify-center font-bold text-xs">
            {user?.email?.[0]?.toUpperCase() || "A"}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">{user?.name || "Admin"}</p>
            <p className="text-xs text-zinc-500 truncate">{user?.email}</p>
          </div>
        </div>
        <button
          onClick={onLogout}
          data-testid={AUTH.logoutBtn}
          className="w-full flex items-center justify-center gap-2 border border-zinc-300 hover:border-zinc-900 px-3 py-2 text-sm transition-all"
        >
          <LogOut size={14} /> Log out
        </button>
      </div>
    </>
  );

  return (
    <div className="min-h-screen flex bg-white text-zinc-900">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex w-[260px] shrink-0 border-r border-zinc-200 bg-zinc-50/60 flex-col">
        {sidebar}
      </aside>

      {/* Mobile Sidebar (drawer) */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/40" onClick={closeMobile} />
          <aside className="relative w-[280px] bg-white border-r border-zinc-200 flex flex-col">{sidebar}</aside>
        </div>
      )}

      {/* Main */}
      <main className="flex-1 min-w-0">
        <div className="border-b border-zinc-200 px-5 lg:px-8 py-4 bg-white flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMobileOpen(true)}
              className="lg:hidden p-2 -ml-2 hover:bg-zinc-100"
              aria-label="Open menu"
              data-testid="admin-mobile-menu"
            >
              <Menu size={18} />
            </button>
            <div className="flex items-center gap-2 tag-strip">
              <Layers size={12} />
              <span className="hidden sm:inline">ONCOST / Admin Console</span>
              <span className="sm:hidden logo-mark text-base text-zinc-900">ONCOST</span>
            </div>
          </div>
          <a
            href="/catalog"
            target="_blank"
            rel="noreferrer"
            className="text-xs underline underline-offset-4 hover:text-[#002FA7]"
          >
            Public catalog ↗
          </a>
        </div>
        <div className="p-5 lg:p-8 max-w-[1400px] mx-auto ">{children}</div>
      </main>
    </div>
  );
}
