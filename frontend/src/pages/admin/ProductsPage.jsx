import React, { useEffect, useState, useMemo, useRef } from "react";
import api, { imageUrl, formatINR } from "@/lib/api";
import { ADMIN } from "@/constants/testIds";
import { toast } from "sonner";
import { Search, Eye, EyeOff, Upload, ArrowUpDown, ArrowUp, ArrowDown, RefreshCw, Pencil, X, Check, FileText, Save, FileUp, Plus } from "lucide-react";
import ImportPdfModal from "@/components/ImportPdfModal";

/** Product table with prominent Upload Image + Edit Price + Edit Details actions. */
export default function ProductsPage() {
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("code");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [editingId, setEditingId] = useState(null); // product id being price-edited
  const [editValue, setEditValue] = useState("");
  const [uploadingId, setUploadingId] = useState(null);
  const [dragId, setDragId] = useState(null);
  const [detailsId, setDetailsId] = useState(null); // product id whose details modal is open
  const [detailsForm, setDetailsForm] = useState({ code: "", set_type: "", items: "", moq: 50, category_id: "" });
  const [savingDetails, setSavingDetails] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ code: "", set_type: "", items: "", sg_price: "", moq: 50, category_id: "", imageFile: null });
  const [addingProduct, setAddingProduct] = useState(false);
  const fileRefs = useRef({});

  const load = async () => {
    setLoading(true);
    try {
      const [{ data: prods }, { data: cats }] = await Promise.all([
        api.get("/products"),
        api.get("/categories"),
      ]);
      setProducts(prods);
      setCategories(cats);
    } catch {
      toast.error("Failed to load products");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const catName = (id) => categories.find(c => c.id === id)?.name || "";

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    let arr = products;
    if (s) {
      arr = arr.filter(p =>
        p.code.toLowerCase().includes(s) ||
        (p.items || "").toLowerCase().includes(s) ||
        (p.set_type || "").toLowerCase().includes(s)
      );
    }
    if (categoryFilter) {
      arr = arr.filter(p => (p.category_id || "") === categoryFilter);
    }
    arr = [...arr];
    if (sort === "price_asc") arr.sort((a, b) => (a.oncost_price || 0) - (b.oncost_price || 0));
    else if (sort === "price_desc") arr.sort((a, b) => (b.oncost_price || 0) - (a.oncost_price || 0));
    else arr.sort((a, b) => a.code.localeCompare(b.code));
    return arr;
  }, [products, q, sort, categoryFilter, categories]);

  const startEdit = (p) => {
    setEditingId(p.id);
    setEditValue(p.override_price ?? p.oncost_price ?? "");
  };
  const cancelEdit = () => {
    setEditingId(null);
    setEditValue("");
  };
  const saveEdit = async (p) => {
    const val = String(editValue).trim();
    const body = { override_price: val === "" ? null : Number(val) };
    if (body.override_price !== null && (isNaN(body.override_price) || body.override_price < 0)) {
      toast.error("Enter a valid price (or leave empty to clear)");
      return;
    }
    try {
      await api.put(`/products/${p.id}`, body);
      toast.success(body.override_price === null ? `Price reset to rule for ${p.code}` : `Price set to ₹${body.override_price} for ${p.code}`);
      setEditingId(null); setEditValue("");
      load();
    } catch {
      toast.error("Could not save price");
    }
  };

  const resetToRule = async (p) => {
    try {
      await api.put(`/products/${p.id}`, { override_price: null });
      toast.success(`Reset to auto for ${p.code}`);
      load();
    } catch { toast.error("Failed"); }
  };

  const onToggleVis = async (p) => {
    try {
      await api.put(`/products/${p.id}`, { visible: !p.visible });
      setProducts(prev => prev.map(x => x.id === p.id ? { ...x, visible: !p.visible } : x));
    } catch { toast.error("Failed"); }
  };

  const openDetails = (p) => {
    setDetailsId(p.id);
    setDetailsForm({
      code: p.code || "",
      set_type: p.set_type || "",
      items: p.items || "",
      moq: p.moq ?? 50,
      category_id: p.category_id || "",
    });
  };
  const closeDetails = () => { setDetailsId(null); setSavingDetails(false); };
  const saveDetails = async () => {
    if (!detailsId) return;
    const body = {
      code: (detailsForm.code || "").trim(),
      set_type: (detailsForm.set_type || "").trim(),
      items: (detailsForm.items || "").trim(),
      moq: Number(detailsForm.moq) || 0,
      category_id: detailsForm.category_id || null,
    };
    if (!body.code) { toast.error("Code is required"); return; }
    if (body.moq < 1) { toast.error("MOQ must be at least 1"); return; }
    setSavingDetails(true);
    try {
      await api.put(`/products/${detailsId}`, body);
      toast.success(`Updated ${body.code}`);
      closeDetails();
      load();
    } catch (e) {
      const msg = e?.response?.data?.detail || "Could not save details";
      toast.error(typeof msg === "string" ? msg : "Save failed");
      setSavingDetails(false);
    }
  };

  const openAdd = () => {
    setAddForm({ code: "", set_type: "", items: "", sg_price: "", moq: 50, category_id: "", imageFile: null });
    setShowAdd(true);
  };
  const closeAdd = () => { setShowAdd(false); setAddingProduct(false); };
  const submitAdd = async () => {
    const body = {
      code: (addForm.code || "").trim(),
      set_type: (addForm.set_type || "").trim(),
      items: (addForm.items || "").trim(),
      sg_price: Number(addForm.sg_price),
      moq: Number(addForm.moq) || 50,
      category_id: addForm.category_id || null,
      visible: true,
    };
    if (!body.code) { toast.error("Product code is required"); return; }
    if (isNaN(body.sg_price) || body.sg_price < 0) { toast.error("Enter a valid supplier price"); return; }
    if (body.moq < 1) { toast.error("MOQ must be at least 1"); return; }
    setAddingProduct(true);
    try {
      const { data: created } = await api.post("/products", body);
      // Optional image upload
      if (addForm.imageFile && created?.id) {
        const fd = new FormData();
        fd.append("file", addForm.imageFile);
        try {
          await api.post(`/products/${created.id}/image`, fd, { headers: { "Content-Type": "multipart/form-data" } });
        } catch {
          toast.warning(`Product ${body.code} created, but image upload failed`);
        }
      }
      toast.success(`Added ${body.code}`);
      closeAdd();
      load();
    } catch (e) {
      const msg = e?.response?.data?.detail || "Could not create product";
      toast.error(typeof msg === "string" ? msg : "Create failed");
      setAddingProduct(false);
    }
  };

  const onUpload = async (p, file) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please choose an image file");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      toast.error("Image too large (max 8MB)");
      return;
    }
    setUploadingId(p.id);
    try {
      const fd = new FormData();
      fd.append("file", file);
      await api.post(`/products/${p.id}/image`, fd, { headers: { "Content-Type": "multipart/form-data" } });
      toast.success(`Image updated for ${p.code}`);
      load();
    } catch {
      toast.error("Upload failed");
    } finally {
      setUploadingId(null);
    }
  };

  const onDrop = (p, e) => {
    e.preventDefault();
    setDragId(null);
    const f = e.dataTransfer.files?.[0];
    if (f) onUpload(p, f);
  };

  const SortBtn = ({ value, label, icon: Icon }) => (
    <button
      onClick={() => setSort(value)}
      data-testid={`sort-${value}`}
      className={`text-xs px-3 py-1.5 border transition-all flex items-center gap-1.5 ${
        sort === value ? "border-[#002FA7] text-[#002FA7] bg-[#002FA7]/5" : "border-zinc-300 text-zinc-600 hover:border-zinc-900"
      }`}
    >
      <Icon size={11} />
      {label}
    </button>
  );

  return (
    <div>
      <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4 mb-6">
        <div>
          <p className="overline">Catalog</p>
          <h1 className="font-display text-4xl font-light mt-1 tracking-tight">Products</h1>
          <p className="text-sm text-zinc-500 mt-2">{products.length} items. Click <b className="text-zinc-900">Edit Price</b> to override a price or <b className="text-zinc-900">Upload Image</b> to replace the supplier photo.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={openAdd}
            data-testid="add-product-btn"
            className="text-xs px-3 py-1.5 bg-[#FF3B30] hover:bg-[#cc2f26] text-white flex items-center gap-1.5"
          >
            <Plus size={12} /> Add Product
          </button>
          <button
            onClick={() => setShowImport(true)}
            data-testid="open-import-pdf"
            className="text-xs px-3 py-1.5 bg-[#002FA7] hover:bg-[#002277] text-white flex items-center gap-1.5"
          >
            <FileUp size={12} /> Import from PDF
          </button>
          {categories.length > 0 && (
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              data-testid="category-filter"
              className="text-xs px-2 py-1.5 border border-zinc-300 bg-white focus:border-[#002FA7] outline-none"
            >
              <option value="">All categories</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
          <SortBtn value="code" label="Code" icon={ArrowUpDown} />
          <SortBtn value="price_asc" label="Price ↑" icon={ArrowUp} />
          <SortBtn value="price_desc" label="Price ↓" icon={ArrowDown} />
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search…"
              className="pl-9 pr-3 py-2 border border-zinc-300 text-sm w-60 focus:border-[#002FA7] outline-none"
              data-testid="products-search"
            />
          </div>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-zinc-500">Loading…</p>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {filtered.map((p) => {
            const isEditing = editingId === p.id;
            const isUploading = uploadingId === p.id;
            const hasOverride = p.override_price !== null && p.override_price !== undefined;
            return (
              <div
                key={p.id}
                data-testid={ADMIN.productRow(p.code)}
                onDragOver={(e) => { e.preventDefault(); setDragId(p.id); }}
                onDragLeave={() => setDragId(null)}
                onDrop={(e) => onDrop(p, e)}
                className={`bg-white border ${dragId === p.id ? "border-[#002FA7] border-dashed bg-[#002FA7]/5" : "border-zinc-200"} p-3 flex items-stretch gap-4 transition-all`}
              >
                {/* Image */}
                <div className="relative w-20 h-20 shrink-0 border border-zinc-200 bg-white">
                  {p.image && (
                    <img src={imageUrl(p.image) + `?v=${p.image}`} alt={p.code} className="w-full h-full object-contain" />
                  )}
                  {isUploading && (
                    <div className="absolute inset-0 bg-white/80 flex items-center justify-center">
                      <RefreshCw size={16} className="animate-spin text-[#002FA7]" />
                    </div>
                  )}
                  <input
                    type="file"
                    accept="image/*"
                    ref={(el) => (fileRefs.current[p.id] = el)}
                    className="hidden"
                    onChange={(e) => onUpload(p, e.target.files?.[0])}
                  />
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-mono text-[12px] font-bold tracking-wider">{p.code}</p>
                    {p.category_id && catName(p.category_id) && (
                      <span className="text-[10px] uppercase tracking-wider bg-zinc-100 text-zinc-700 px-1.5 py-0.5">{catName(p.category_id)}</span>
                    )}
                    {!p.visible && <span className="text-[10px] uppercase tracking-wider border border-zinc-300 text-zinc-500 px-1.5">hidden</span>}
                    {hasOverride && <span className="text-[10px] uppercase tracking-wider bg-[#002FA7] text-white px-1.5">custom price</span>}
                  </div>
                  <p className="font-display text-base font-medium mt-0.5 truncate">{p.set_type}</p>
                  <p className="text-xs text-zinc-500 mt-0.5 line-clamp-1">{p.items}</p>
                  <p className="overline text-[10px] mt-2">MOQ {p.moq} • SG cost <span className="font-mono">{formatINR(p.sg_price)}</span></p>
                </div>

                {/* Price + Actions */}
                <div className="flex flex-col items-end gap-2 shrink-0">
                  {isEditing ? (
                    <div className="flex items-center gap-1.5">
                      <span className="text-zinc-500 font-mono text-sm">₹</span>
                      <input
                        data-testid={`price-input-${p.code}`}
                        autoFocus
                        type="number"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") saveEdit(p); if (e.key === "Escape") cancelEdit(); }}
                        placeholder="auto"
                        className="w-28 px-2 py-1.5 border border-[#002FA7] text-right font-mono text-base outline-none focus:ring-2 focus:ring-[#002FA7]/20"
                      />
                      <button data-testid={`price-save-${p.code}`} onClick={() => saveEdit(p)} className="w-8 h-8 bg-[#002FA7] text-white flex items-center justify-center hover:bg-[#002277]" title="Save"><Check size={14} /></button>
                      <button data-testid={`price-cancel-${p.code}`} onClick={cancelEdit} className="w-8 h-8 border border-zinc-300 text-zinc-600 flex items-center justify-center hover:border-zinc-900" title="Cancel"><X size={14} /></button>
                    </div>
                  ) : (
                    <p className="font-display text-2xl font-medium leading-none">{formatINR(p.oncost_price)}</p>
                  )}

                  {!isEditing && (
                    <div className="flex items-center gap-2 flex-wrap justify-end">
                      <button
                        data-testid={`edit-price-${p.code}`}
                        onClick={() => startEdit(p)}
                        className="text-xs px-3 py-1.5 border border-[#002FA7] text-[#002FA7] hover:bg-[#002FA7] hover:text-white flex items-center gap-1.5 transition-all"
                      >
                        <Pencil size={12} /> Edit Price
                      </button>
                      <button
                        data-testid={`edit-details-${p.code}`}
                        onClick={() => openDetails(p)}
                        className="text-xs px-3 py-1.5 border border-zinc-300 hover:border-[#002FA7] hover:text-[#002FA7] flex items-center gap-1.5"
                      >
                        <FileText size={12} /> Edit Details
                      </button>
                      <button
                        data-testid={`product-upload-${p.code}`}
                        onClick={() => fileRefs.current[p.id]?.click()}
                        disabled={isUploading}
                        className="text-xs px-3 py-1.5 border border-zinc-300 hover:border-[#002FA7] hover:text-[#002FA7] flex items-center gap-1.5"
                      >
                        <Upload size={12} /> Upload Image
                      </button>
                      <button
                        onClick={() => onToggleVis(p)}
                        data-testid={ADMIN.productVisibility(p.code)}
                        className="w-8 h-8 border border-zinc-300 flex items-center justify-center hover:border-zinc-900"
                        title={p.visible ? "Hide from catalog" : "Show in catalog"}
                      >
                        {p.visible ? <Eye size={12} /> : <EyeOff size={12} className="text-zinc-400" />}
                      </button>
                      {hasOverride && (
                        <button
                          data-testid={`reset-price-${p.code}`}
                          onClick={() => resetToRule(p)}
                          className="text-[10px] uppercase tracking-wider text-zinc-500 hover:text-zinc-900 underline-offset-2 hover:underline"
                          title="Remove custom price, use rule"
                        >
                          reset
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-8 p-4 bg-zinc-50 border border-zinc-200 text-xs text-zinc-600 leading-relaxed">
        <p className="overline text-[10px] mb-1">Tips</p>
        <ul className="space-y-1 list-disc list-inside">
          <li><b>Edit Price</b> sets a custom price for this item (overrides the global markup rule).</li>
          <li><b>Edit Details</b> changes the code, set type, description and MOQ.</li>
          <li>Click <b>reset</b> next to a row to remove the custom price and follow the rule again.</li>
          <li><b>Upload Image</b> replaces the supplier photo. You can also <b>drag and drop</b> an image file onto any row.</li>
          <li>Allowed: JPG, PNG, WEBP — up to 8 MB. Images are auto-resized and centered on a white background.</li>
        </ul>
      </div>

      {/* Edit Details modal */}
      {detailsId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={closeDetails}
          data-testid="details-modal"
        >
          <div
            className="bg-white max-w-xl w-full border border-zinc-200 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-zinc-200 flex items-center justify-between">
              <div>
                <p className="overline text-[10px]">Edit Product Details</p>
                <h3 className="font-display text-xl font-medium mt-1">{detailsForm.code || "—"}</h3>
              </div>
              <button onClick={closeDetails} className="p-2 hover:bg-zinc-100" data-testid="details-close"><X size={16} /></button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div>
                <label className="overline text-[10px]">Code (SKU)</label>
                <input
                  data-testid="details-code"
                  value={detailsForm.code}
                  onChange={(e) => setDetailsForm(f => ({ ...f, code: e.target.value }))}
                  className="mt-2 w-full px-3 py-2 border border-zinc-300 font-mono text-sm focus:border-[#002FA7] outline-none"
                  placeholder="e.g. SG 501"
                />
              </div>
              <div>
                <label className="overline text-[10px]">Set type / title</label>
                <input
                  data-testid="details-set-type"
                  value={detailsForm.set_type}
                  onChange={(e) => setDetailsForm(f => ({ ...f, set_type: e.target.value }))}
                  className="mt-2 w-full px-3 py-2 border border-zinc-300 text-sm focus:border-[#002FA7] outline-none"
                  placeholder="e.g. 6in1"
                />
              </div>
              <div>
                <label className="overline text-[10px]">Description (items list)</label>
                <textarea
                  data-testid="details-items"
                  rows={4}
                  value={detailsForm.items}
                  onChange={(e) => setDetailsForm(f => ({ ...f, items: e.target.value }))}
                  className="mt-2 w-full px-3 py-2 border border-zinc-300 text-sm focus:border-[#002FA7] outline-none resize-y"
                  placeholder="Note Book, Mug, Pen, Flask, Card Holder, Key Chain"
                />
                <p className="text-[11px] text-zinc-500 mt-1">Comma-separated list of contents. Shown to customers on the public catalog and quotations.</p>
              </div>
              <div>
                <label className="overline text-[10px]">Minimum Order Quantity (MOQ)</label>
                <input
                  data-testid="details-moq"
                  type="number"
                  min={1}
                  value={detailsForm.moq}
                  onChange={(e) => setDetailsForm(f => ({ ...f, moq: e.target.value }))}
                  className="mt-2 w-32 px-3 py-2 border border-zinc-300 font-mono text-sm focus:border-[#002FA7] outline-none"
                />
              </div>
              <div>
                <label className="overline text-[10px]">Category</label>
                <select
                  data-testid="details-category"
                  value={detailsForm.category_id || ""}
                  onChange={(e) => setDetailsForm(f => ({ ...f, category_id: e.target.value }))}
                  className="mt-2 w-full px-3 py-2 border border-zinc-300 text-sm focus:border-[#002FA7] outline-none bg-white"
                >
                  <option value="">— No category —</option>
                  {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <p className="text-[11px] text-zinc-500 mt-1">Manage categories on the <b>Categories</b> page in the sidebar.</p>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-zinc-200 flex items-center justify-end gap-2 bg-zinc-50">
              <button
                onClick={closeDetails}
                data-testid="details-cancel"
                className="px-4 py-2 border border-zinc-300 text-sm hover:border-zinc-900"
              >
                Cancel
              </button>
              <button
                onClick={saveDetails}
                disabled={savingDetails}
                data-testid="details-save"
                className="px-4 py-2 bg-[#002FA7] hover:bg-[#002277] text-white text-sm flex items-center gap-2 disabled:opacity-50"
              >
                <Save size={14} /> {savingDetails ? "Saving…" : "Save changes"}
              </button>
            </div>
          </div>
        </div>
      )}
      {showAdd && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={closeAdd}
          data-testid="add-product-modal"
        >
          <div
            className="bg-white max-w-xl w-full border border-zinc-200 shadow-xl max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-zinc-200 flex items-center justify-between">
              <div>
                <p className="overline text-[10px]">New Product</p>
                <h3 className="font-display text-xl font-medium mt-1">{addForm.code || "Untitled"}</h3>
              </div>
              <button onClick={closeAdd} className="p-2 hover:bg-zinc-100" data-testid="add-product-close"><X size={16} /></button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="overline text-[10px]">Code (SKU) *</label>
                  <input
                    data-testid="add-product-code"
                    autoFocus
                    value={addForm.code}
                    onChange={(e) => setAddForm(f => ({ ...f, code: e.target.value }))}
                    className="mt-2 w-full px-3 py-2 border border-zinc-300 font-mono text-sm focus:border-[#002FA7] outline-none"
                    placeholder="e.g. OC 101"
                  />
                </div>
                <div>
                  <label className="overline text-[10px]">Set type / title</label>
                  <input
                    data-testid="add-product-set-type"
                    value={addForm.set_type}
                    onChange={(e) => setAddForm(f => ({ ...f, set_type: e.target.value }))}
                    className="mt-2 w-full px-3 py-2 border border-zinc-300 text-sm focus:border-[#002FA7] outline-none"
                    placeholder="e.g. 5in1, Single"
                  />
                </div>
              </div>
              <div>
                <label className="overline text-[10px]">Description (items)</label>
                <textarea
                  data-testid="add-product-items"
                  rows={3}
                  value={addForm.items}
                  onChange={(e) => setAddForm(f => ({ ...f, items: e.target.value }))}
                  className="mt-2 w-full px-3 py-2 border border-zinc-300 text-sm focus:border-[#002FA7] outline-none resize-y"
                  placeholder="Bottle, Mug, Notebook, Pen, Card Holder"
                />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="overline text-[10px]">Supplier Price (₹) *</label>
                  <input
                    data-testid="add-product-sg-price"
                    type="number"
                    min={0}
                    value={addForm.sg_price}
                    onChange={(e) => setAddForm(f => ({ ...f, sg_price: e.target.value }))}
                    className="mt-2 w-full px-3 py-2 border border-zinc-300 font-mono text-sm focus:border-[#002FA7] outline-none"
                    placeholder="e.g. 850"
                  />
                  <p className="text-[10px] text-zinc-500 mt-1">ONCOST price = SG + markup rule</p>
                </div>
                <div>
                  <label className="overline text-[10px]">MOQ</label>
                  <input
                    data-testid="add-product-moq"
                    type="number"
                    min={1}
                    value={addForm.moq}
                    onChange={(e) => setAddForm(f => ({ ...f, moq: e.target.value }))}
                    className="mt-2 w-full px-3 py-2 border border-zinc-300 font-mono text-sm focus:border-[#002FA7] outline-none"
                  />
                </div>
                <div>
                  <label className="overline text-[10px]">Category</label>
                  <select
                    data-testid="add-product-category"
                    value={addForm.category_id}
                    onChange={(e) => setAddForm(f => ({ ...f, category_id: e.target.value }))}
                    className="mt-2 w-full px-3 py-2 border border-zinc-300 text-sm focus:border-[#002FA7] outline-none bg-white"
                  >
                    <option value="">— None —</option>
                    {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="overline text-[10px]">Product Image (optional)</label>
                <input
                  type="file"
                  accept="image/*"
                  data-testid="add-product-image"
                  onChange={(e) => setAddForm(f => ({ ...f, imageFile: e.target.files?.[0] || null }))}
                  className="mt-2 block w-full text-sm text-zinc-600 file:mr-3 file:px-3 file:py-1.5 file:border file:border-zinc-300 file:bg-white file:text-zinc-700 file:text-xs hover:file:border-[#002FA7]"
                />
                {addForm.imageFile && (
                  <p className="text-[11px] text-zinc-500 mt-1">Selected: {addForm.imageFile.name}</p>
                )}
                <p className="text-[10px] text-zinc-400 mt-1">JPG, PNG, WEBP up to 8 MB. Auto-cropped to a clean square.</p>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-zinc-200 flex items-center justify-end gap-2 bg-zinc-50">
              <button
                onClick={closeAdd}
                data-testid="add-product-cancel"
                className="px-4 py-2 border border-zinc-300 text-sm hover:border-zinc-900"
              >
                Cancel
              </button>
              <button
                onClick={submitAdd}
                disabled={addingProduct}
                data-testid="add-product-submit"
                className="px-4 py-2 bg-[#FF3B30] hover:bg-[#cc2f26] text-white text-sm flex items-center gap-2 disabled:opacity-50"
              >
                <Save size={14} /> {addingProduct ? "Adding…" : "Add Product"}
              </button>
            </div>
          </div>
        </div>
      )}
      {showImport && <ImportPdfModal onClose={() => setShowImport(false)} onDone={load} />}
    </div>
  );
}
