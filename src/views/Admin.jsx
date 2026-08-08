// Admin — extracted from salon-manager.jsx.

import { Header, Modal } from "../components/primitives.jsx";
import { reconcileCustomers } from "../lib/customers.js";
import { auth } from "../lib/firebase.js";
import { reconcileLoyalty, reconcilePackages } from "../lib/loyalty.js";
import { todayStr, uid } from "../lib/ui/format.js";
import { SEED_ITEMS } from "../lib/ui/seeds.js";
import { EmailAuthProvider, reauthenticateWithCredential } from "firebase/auth";
import { useMemo, useState } from "react";
import { S } from "../lib/ui/css.js";

// ---------- small components ----------
// ---------- Admin (password-gated bulk / destructive operations) ----------
// Every action requires: confirm → confirm again → re-enter the account password
// (verified against Firebase Auth). Only on a successful re-auth does the action run.
function Admin({ setItems, setSales, setExpenses, setLogs, sales, customers, setCustomers, customerPackages, setCustomerPackages, config, user, notify, log }) {
  const [pending, setPending] = useState(null); // the chosen operation
  const [step, setStep] = useState(1); // 1 = first confirm, 2 = password
  const [pwd, setPwd] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  // How far the denormalized fields have drifted from the bills. Normally 0: the shell
  // reconciles them on every change. A non-zero count means data arrived from outside the app
  // (a restore, a hand-edit in the Firebase console), which is exactly when the repair tool
  // below earns its keep.
  const drift = useMemo(() => {
    const fixedStats = reconcileCustomers(customers, sales);
    const fixedLoyalty = reconcileLoyalty(fixedStats, sales, config, todayStr());
    const fixedPkgs = reconcilePackages(customerPackages, sales);
    const changedCustomers = fixedLoyalty === customers ? 0 : fixedLoyalty.filter((c, i) => c !== customers[i]).length;
    const changedPkgs = fixedPkgs === customerPackages ? 0 : fixedPkgs.filter((p, i) => p !== customerPackages[i]).length;
    return { customers: changedCustomers, packages: changedPkgs, total: changedCustomers + changedPkgs };
  }, [customers, sales, config, customerPackages]);

  const ops = [
    // The escape hatch for the derived-not-stored design. Everything it recomputes is already
    // recomputed automatically as bills change; this exists for data that arrived from outside
    // the app, where "automatically" never ran.
    { key: "recompute", label: "Recompute customer stats, points & packages", group: "Salon",
      desc:
        "Rebuild every customer's visit count, total spend, loyalty points and tier — and every " +
        "package's remaining sessions — from the bills. The bills are the source of truth, so this " +
        "can only ever correct these figures, never lose anything. Safe to run any time; worth " +
        "running after restoring a backup." +
        (drift.total ? ` Right now ${drift.total} record(s) look out of step.` : " Everything currently matches."),
      apply: () => {
        setCustomers((cs) => reconcileLoyalty(reconcileCustomers(cs, sales), sales, config, todayStr()));
        setCustomerPackages((cps) => reconcilePackages(cps, sales));
      },
      logMsg: "Recomputed customer stats, loyalty points and package balances from bills",
      toast: drift.total ? `Corrected ${drift.total} record(s)` : "Everything already matched" },
    { key: "zeroStock", label: "Zero all stock", group: "Inventory",
      desc: "Set stock to 0 and clear every batch for all items. Names and prices are kept.",
      apply: () => setItems((l) => l.map((i) => ({ ...i, stock: 0, batches: [], updatedAt: todayStr() }))),
      logMsg: "Reset all stock to 0", toast: "All stock set to 0" },
    { key: "delItems", label: "Delete ALL inventory items", group: "Danger zone", danger: true,
      desc: "Permanently remove every item from inventory. Sales history is kept.",
      apply: () => setItems([]), logMsg: "Deleted all inventory items", toast: "All items deleted" },
    { key: "clrSales", label: "Clear all sales history", group: "Danger zone", danger: true,
      desc: "Permanently delete every recorded sale. Inventory stock is NOT changed.",
      apply: () => setSales([]), logMsg: "Cleared all sales history", toast: "Sales history cleared" },
    { key: "clrExp", label: "Clear all expenses", group: "Danger zone", danger: true,
      desc: "Permanently delete every expense entry.",
      apply: () => setExpenses([]), logMsg: "Cleared all expenses", toast: "Expenses cleared" },
    { key: "clrLogs", label: "Clear activity log", group: "Danger zone",
      desc: "Delete all activity-log entries.",
      apply: () => setLogs([]), logMsg: "Cleared activity log", toast: "Activity log cleared" },
    { key: "factory", label: "Factory reset", group: "Danger zone", danger: true,
      desc: "Replace inventory with the fresh starter catalogue (all at 0 stock) and delete ALL sales, expenses and logs. Cannot be undone.",
      apply: () => {
        setItems(SEED_ITEMS.map((i) => ({ ...i, id: uid(), stock: 0, batches: [] })));
        setSales([]); setExpenses([]); setLogs([]);
      },
      logMsg: "Factory reset performed", toast: "Factory reset complete" },
  ];

  const groups = [...new Set(ops.map((o) => o.group))];
  const choose = (op) => { if (op.disabled) return; setPending(op); setStep(1); setPwd(""); setErr(""); };
  const close = () => { setPending(null); setStep(1); setPwd(""); setErr(""); setBusy(false); };

  const confirmRun = async () => {
    if (!pwd) return setErr("Enter your account password.");
    if (!user?.email) return setErr("No signed-in account to verify against.");
    setBusy(true); setErr("");
    try {
      const cred = EmailAuthProvider.credential(user.email, pwd);
      await reauthenticateWithCredential(auth.currentUser, cred);
    } catch (e) {
      setBusy(false);
      setErr(e?.code === "auth/too-many-requests"
        ? "Too many attempts — please wait a minute and retry."
        : "Incorrect password — operation cancelled.");
      return;
    }
    try { pending.apply(); log("admin", pending.logMsg); notify(pending.toast); }
    catch (e) { console.error("admin op failed", e); notify("⚠ Operation failed."); }
    close();
  };

  return (
    <div>
      <Header title="Admin" sub="Bulk & destructive operations · double-confirm + password required" />
      {groups.map((grp) => (
        <section key={grp} style={{ ...S.panel, marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", color: grp === "Danger zone" ? "#B23B2E" : "var(--text-mid, #6B7E74)", marginBottom: 6 }}>{grp}</div>
          {ops.filter((o) => o.group === grp).map((op) => (
            <div key={op.key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, padding: "10px 0", borderTop: "1px solid #EAF0EA" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700, color: op.danger ? "#B23B2E" : "var(--ink)" }}>{op.label}</div>
                <div style={{ fontSize: 12.5, color: "var(--text-mid, #5E7468)" }}>{op.desc}</div>
              </div>
              <button
                className="btn"
                disabled={op.disabled}
                onClick={() => choose(op)}
                style={{ flex: "0 0 auto", opacity: op.disabled ? 0.5 : 1, ...(op.danger ? { borderColor: "#E2B6B0", color: "#B23B2E" } : {}) }}
              >
                Run
              </button>
            </div>
          ))}
        </section>
      ))}

      {pending && (
        <Modal title={step === 1 ? "Confirm operation" : "Enter password to confirm"} onClose={close}>
          {step === 1 ? (
            <>
              <p style={{ marginTop: 0, fontWeight: 700, color: pending.danger ? "#B23B2E" : "var(--ink)" }}>{pending.label}</p>
              <p style={{ color: "var(--text-mid, #5E7468)", fontSize: 13 }}>{pending.desc}</p>
              <p style={{ color: pending.danger ? "#B23B2E" : "var(--text-mid, #5E7468)", fontSize: 13 }}>
                This applies to all signed-in devices and may not be reversible. Continue?
              </p>
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 14 }}>
                <button className="btn" onClick={close}>Cancel</button>
                <button className="btn primary" onClick={() => { setStep(2); setErr(""); }}>Yes, continue</button>
              </div>
            </>
          ) : (
            <>
              <p style={{ marginTop: 0, fontSize: 13, color: "var(--text-mid, #5E7468)" }}>
                Final step. Enter the password for <b>{user?.email}</b> to run <b>{pending.label}</b>.
              </p>
              <input
                className="input" type="password" autoFocus placeholder="Account password"
                value={pwd} onChange={(e) => setPwd(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") confirmRun(); }}
                style={{ width: "100%", boxSizing: "border-box" }}
              />
              {err && <div style={{ color: "#B23B2E", fontSize: 12.5, marginTop: 8 }}>{err}</div>}
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 14 }}>
                <button className="btn" onClick={close} disabled={busy}>Cancel</button>
                <button className="btn primary" onClick={confirmRun} disabled={busy}>{busy ? "Verifying…" : "Confirm & run"}</button>
              </div>
            </>
          )}
        </Modal>
      )}
    </div>
  );
}


export { Admin };
export default Admin;
