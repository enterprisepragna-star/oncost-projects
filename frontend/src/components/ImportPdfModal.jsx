import React, { useState, useEffect, useRef } from "react";
import api, { imageUrl, formatINR } from "@/lib/api";
import { X, Upload, RefreshCw, Save, Trash2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

/** Modal: upload a PDF, extract, review, then save under a vendor. */
export default function ImportPdfModal({ onClose, onDone }) {
  const fileRef = useRef(null);
  const [phase, setPhase] = useState("upload"); // upload | review | saving
  const [busy, setBusy] = useState(false);
  const [vendors, setVendors] = useState([]);
  const [vendorId, setVendorId] = useState("");
  const [newVendorName, setNewVendorName] = useState("");
  const [codePrefix, setCodePrefix] = useState("");
  const [useCustomRule, setUseCustomRule] = useState(false);
  const [rule, setRule] = useState({ threshold: 1000, below_increment: 50, at_or_above_increment: 100 });
  const [products, setProducts] = useState([]);

  useEffect(() => { api.get("/vendors").then(({ data }) => setVendors(data)); }, []);

  const onExtract = async (file) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".pdf")) return toast.error("Please choose a PDF");
    if (file.size > 80 * 1024 * 1024) return toast.error("PDF too large (max 80MB)");
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { data } = await api.post("/import/pdf/extract", fd, { headers: { "Content-Type": "multipart/form-data" } });
      setProducts(data.products || []);
      setPhase("review");
      toast.success(`Extracted ${data.count} products`);
    } catch (e) {
      toast.error("Extraction failed");
    } finally { setBusy(false); }
  };

  const updateRow = (i, key, val) => {
    setProducts(prev => prev.map((p, idx) => idx === i ? { ...p, [key]: val } : p));
  };
  const removeRow = (i) => setProducts(prev => prev.filter((_, idx) => idx !== i));

  const onSave = async () => {
    let vid = vendorId;
    if (!vid) {
      if (!newVendorName.trim()) return toast.error("Select or create a vendor");
      try {
        const { data } = await api.post("/vendors", { name: newVendorName.trim(), code_prefix: codePrefix.trim() });
        vid = data.id;
      } catch { return toast.error("Vendor create failed"); }
    }
    if (products.length === 0) return toast.error("Nothing to save");
    setPhase("saving");
    try {
      const payload = {
        vendor_id: vid,
        code_prefix: codePrefix.trim(),
        use_custom_rule: useCustomRule,
        threshold: Number(rule.threshold) || 1000,
        below_increment: Number(rule.below_increment) || 0,
        at_or_above_increment: Number(rule.at_or_above_increment) || 0,
        products: products.map(p => ({
          code: p.code, set_type: p.set_type, items: p.items,
          sg_price: Number(p.sg_price) || 0, moq: Number(p.moq) || 50, image: p.image,
        })),
      };
      const { data } = await api.post("/import/pdf/commit", payload);
      toast.success(`Imported ${data.inserted} products (${data.skipped} skipped)`);
      onDone?.();
      onClose();
    } catch (e) {
      toast.error("Import failed");
      setPhase("review");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3" onClick={onClose}>
      <div className="bg-white border border-zinc-200 shadow-xl w-full max-w-5xl max-h-[92vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-zinc-200 flex items-center justify-between">
          <div>
            <p className="overline text-[10px]">Catalog Import</p>
            <h3 className="font-display text-xl font-medium mt-1">Import products from a supplier PDF</h3>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-zinc-100"><X size={16} /></button>
        </div>

        {phase === "upload" && (
          <div className="p-8 space-y-6 overflow-auto">
            <div
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); onExtract(e.dataTransfer.files?.[0]); }}
              className="border-2 border-dashed border-zinc-300 hover:border-[#002FA7] p-12 text-center cursor-pointer transition-all"
              data-testid="import-dropzone"
            >
              {busy ? (
                <><RefreshCw size={28} className="mx-auto animate-spin text-[#002FA7]" /><p className="mt-3 text-sm">Extracting…</p></>
              ) : (
                <><Upload size={28} className="mx-auto text-zinc-400" />
                <p className="mt-3 font-display text-lg">Drop a PDF here, or click to choose</p>
                <p className="text-xs text-zinc-500 mt-2">Each product is auto-parsed: code, items, price, MOQ, image. You'll review before saving.</p></>
              )}
              <input onClick={(e) => e.stopPropagation()}
                ref={fileRef} type="file" accept="application/pdf" className="hidden"
                data-testid="import-file"
                onChange={(e) => onExtract(e.target.files?.[0])}
              />
            </div>
          </div>
        )}

        {phase === "review" && (
          <div className="flex-1 overflow-auto p-6 space-y-5">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div>
                <p className="overline text-[10px]">Vendor</p>
                <select
                  data-testid="import-vendor"
                  value={vendorId}
                  onChange={(e) => setVendorId(e.target.value)}
                  className="mt-2 w-full px-3 py-2 border border-zinc-300 text-sm focus:border-[#002FA7] outline-none bg-white"
                >
                  <option value="">— Create new vendor —</option>
                  {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
              </div>
              {!vendorId && (
                <div>
                  <p className="overline text-[10px]">New vendor name</p>
                  <input onClick={(e) => e.stopPropagation()}
                    data-testid="import-new-vendor"
                    value={newVendorName}
                    onChange={(e) => setNewVendorName(e.target.value)}
                    placeholder="e.g. SG Crafts Pvt Ltd"
                    className="mt-2 w-full px-3 py-2 border border-zinc-300 text-sm focus:border-[#002FA7] outline-none"
                  />
                </div>
              )}
              <div>
                <p className="overline text-[10px]">Code prefix (optional)</p>
                <input onClick={(e) => e.stopPropagation()}
                  data-testid="import-prefix"
                  value={codePrefix}
                  onChange={(e) => setCodePrefix(e.target.value)}
                  placeholder="e.g. OC  (rewrites SG 547 → OC 547)"
                  className="mt-2 w-full px-3 py-2 border border-zinc-300 text-sm focus:border-[#002FA7] outline-none font-mono"
                />
              </div>
            </div>

            <div className="border border-zinc-200 bg-zinc-50 p-3">
              <label className="text-sm font-medium flex items-center gap-2">
                <input onClick={(e) => e.stopPropagation()} type="checkbox" checked={useCustomRule} onChange={(e) => setUseCustomRule(e.target.checked)} data-testid="import-use-rule" />
                Apply a custom pricing rule for this batch
              </label>
              {useCustomRule && (
                <div className="grid grid-cols-3 gap-3 mt-3">
                  <input onClick={(e) => e.stopPropagation()} type="number" value={rule.threshold} onChange={(e) => setRule(r => ({ ...r, threshold: e.target.value }))} placeholder="Threshold (₹)" className="px-2 py-1.5 border border-zinc-300 text-sm" />
                  <input onClick={(e) => e.stopPropagation()} type="number" value={rule.below_increment} onChange={(e) => setRule(r => ({ ...r, below_increment: e.target.value }))} placeholder="Add below threshold" className="px-2 py-1.5 border border-zinc-300 text-sm" />
                  <input onClick={(e) => e.stopPropagation()} type="number" value={rule.at_or_above_increment} onChange={(e) => setRule(r => ({ ...r, at_or_above_increment: e.target.value }))} placeholder="Add at/above threshold" className="px-2 py-1.5 border border-zinc-300 text-sm" />
                </div>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="overline">Review extracted products ({products.length})</p>
                <p className="text-xs text-zinc-500">Edit any cell. Remove with the trash icon.</p>
              </div>
              <div className="border border-zinc-200 max-h-[44vh] overflow-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-white">
                    <tr className="border-b border-zinc-900 text-left">
                      <th className="p-2 overline">Image</th>
                      <th className="p-2 overline">Code</th>
                      <th className="p-2 overline">Set type</th>
                      <th className="p-2 overline">Items</th>
                      <th className="p-2 overline">MOQ</th>
                      <th className="p-2 overline">SG Price</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {products.map((p, i) => (
                      <tr key={i} className="border-b border-zinc-200">
                        <td className="p-2 w-16">{p.image && <img src={imageUrl(p.image)} alt="" className="w-12 h-12 object-contain bg-white border border-zinc-200" />}</td>
                        <td className="p-2 w-28"><input onClick={(e) => e.stopPropagation()} value={p.code} onChange={(e) => updateRow(i, "code", e.target.value)} className="w-full px-1.5 py-1 border border-zinc-300 font-mono text-xs" /></td>
                        <td className="p-2 w-24"><input onClick={(e) => e.stopPropagation()} value={p.set_type || ""} onChange={(e) => updateRow(i, "set_type", e.target.value)} className="w-full px-1.5 py-1 border border-zinc-300 text-xs" /></td>
                        <td className="p-2"><input onClick={(e) => e.stopPropagation()} value={p.items || ""} onChange={(e) => updateRow(i, "items", e.target.value)} className="w-full px-1.5 py-1 border border-zinc-300 text-xs" /></td>
                        <td className="p-2 w-16"><input onClick={(e) => e.stopPropagation()} type="number" value={p.moq || 50} onChange={(e) => updateRow(i, "moq", e.target.value)} className="w-full px-1.5 py-1 border border-zinc-300 font-mono text-xs text-right" /></td>
                        <td className="p-2 w-20"><input onClick={(e) => e.stopPropagation()} type="number" value={p.sg_price || 0} onChange={(e) => updateRow(i, "sg_price", e.target.value)} className="w-full px-1.5 py-1 border border-zinc-300 font-mono text-xs text-right" /></td>
                        <td className="p-2 w-8"><button onClick={() => removeRow(i)} className="text-zinc-400 hover:text-red-600"><Trash2 size={12} /></button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        <div className="px-6 py-4 border-t border-zinc-200 flex items-center justify-end gap-2 bg-zinc-50">
          <button onClick={onClose} className="px-4 py-2 border border-zinc-300 text-sm hover:border-zinc-900">Cancel</button>
          {phase === "review" && (
            <button onClick={onSave} disabled={phase === "saving"} data-testid="import-save" className="px-5 py-2 bg-[#002FA7] hover:bg-[#002277] text-white text-sm flex items-center gap-2 disabled:opacity-50">
              <Save size={14} /> {phase === "saving" ? "Saving…" : `Save ${products.length} products`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
