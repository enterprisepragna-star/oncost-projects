// seo.js — One-shot SEO + structured-data injector for every page on oncost.shop
// Adds JSON-LD (Organization / WebSite / OnlineStore) sitewide and Product
// schema on product detail pages. Also injects Open Graph + Twitter card meta.
// Include via: <script defer src="/seo.js"></script>
(function () {
  'use strict';
  const SITE   = 'https://www.oncost.shop';
  const LOGO   = SITE + '/logo.png';
  const OGIMG  = SITE + '/og-image.jpg';
  const PHONE  = '+919059424167';
  const SOCIAL = [
    'https://www.instagram.com/oncost_store/',
    'https://www.facebook.com/profile.php?id=61585630141363',
    'https://wa.me/919059424167'
  ];

  // ---------- helpers ----------
  function injectJSONLD(data) {
    const s = document.createElement('script');
    s.type = 'application/ld+json';
    s.textContent = JSON.stringify(data);
    document.head.appendChild(s);
  }
  function setMeta(attr, name, content) {
    if (!content) return;
    let el = document.head.querySelector(`meta[${attr}="${name}"]`);
    if (!el) {
      el = document.createElement('meta');
      el.setAttribute(attr, name);
      document.head.appendChild(el);
    }
    el.setAttribute('content', content);
  }
  function getCanonical() {
    const url = new URL(location.href);
    url.search = ''; url.hash = '';
    return url.toString();
  }

  // ---------- 1. Organization schema (sitewide) ----------
  injectJSONLD({
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': SITE + '/#organization',
    name: 'ONCOST',
    alternateName: 'ONCOST Gifts',
    url: SITE,
    logo: LOGO,
    image: OGIMG,
    description: 'ONCOST is a gifting platform specializing in corporate gifting, return gifts, birthday return gifts, thambulam sets, event hampers, festive gifting, and customized gift solutions across India.',
    foundingDate: '2025',
    founder: { '@type': 'Person', name: 'Pragna Enterprise' },
    email: 'support@oncost.shop',
    telephone: PHONE,
    sameAs: SOCIAL,
    address: {
      '@type': 'PostalAddress',
      addressLocality: 'Hyderabad',
      addressRegion: 'Telangana',
      addressCountry: 'IN'
    },
    areaServed: { '@type': 'Country', name: 'India' },
    knowsAbout: [
      'Corporate Gifting', 'Return Gifts', 'Birthday Return Gifts',
      'Wedding Return Gifts', 'Thambulam Sets', 'Festive Gift Hampers',
      'Customized Gift Sets', 'Bulk Gifting', 'Employee Gifts', 'Event Giveaways'
    ],
    contactPoint: [{
      '@type': 'ContactPoint',
      telephone: PHONE,
      contactType: 'customer service',
      email: 'support@oncost.shop',
      areaServed: 'IN',
      availableLanguage: ['en', 'hi', 'te']
    }]
  });

  // ---------- 2. WebSite schema with SearchAction (sitewide) ----------
  injectJSONLD({
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': SITE + '/#website',
    url: SITE,
    name: 'ONCOST',
    publisher: { '@id': SITE + '/#organization' },
    potentialAction: {
      '@type': 'SearchAction',
      target: { '@type': 'EntryPoint', urlTemplate: SITE + '/products.html?q={search_term_string}' },
      'query-input': 'required name=search_term_string'
    }
  });

  // ---------- 3. OnlineStore schema (sitewide) ----------
  injectJSONLD({
    '@context': 'https://schema.org',
    '@type': 'OnlineStore',
    '@id': SITE + '/#store',
    name: 'ONCOST',
    url: SITE,
    description: 'Corporate gifting and return gifts marketplace.',
    parentOrganization: { '@id': SITE + '/#organization' },
    paymentAccepted: ['Credit Card', 'Debit Card', 'UPI', 'Net Banking', 'Wallet'],
    currenciesAccepted: 'INR'
  });

  // ---------- 4. Open Graph + Twitter card meta (sitewide defaults) ----------
  const title = document.title || 'ONCOST · Premium Gifting & Return Gifts';
  const desc  = (document.head.querySelector('meta[name="description"]')?.content)
              || 'Curated brass, German silver, tin and thambulam gifts for weddings, poojas, birthdays and corporate events. Pan-India delivery.';
  setMeta('property', 'og:type',        location.pathname.includes('product.html') ? 'product' : 'website');
  setMeta('property', 'og:url',         getCanonical());
  setMeta('property', 'og:title',       title);
  setMeta('property', 'og:description', desc);
  setMeta('property', 'og:image',       OGIMG);
  setMeta('property', 'og:site_name',   'ONCOST');
  setMeta('property', 'og:locale',      'en_IN');
  setMeta('name',     'twitter:card',        'summary_large_image');
  setMeta('name',     'twitter:title',       title);
  setMeta('name',     'twitter:description', desc);
  setMeta('name',     'twitter:image',       OGIMG);
  // Canonical URL
  if (!document.head.querySelector('link[rel="canonical"]')) {
    const link = document.createElement('link');
    link.rel = 'canonical'; link.href = getCanonical();
    document.head.appendChild(link);
  }

  // ---------- 5. Page-specific schemas ----------
  // 5a. BreadcrumbList (auto-built from URL path)
  (function injectBreadcrumb() {
    const parts = location.pathname.split('/').filter(Boolean);
    if (!parts.length) return; // homepage — skip
    const items = [{ '@type':'ListItem', position:1, name:'Home', item: SITE + '/' }];
    let acc = SITE;
    parts.forEach((seg, i) => {
      acc += '/' + seg;
      const niceName = decodeURIComponent(seg.replace(/\.html?$/i, '').replace(/[-_]/g, ' '))
                        .replace(/\b\w/g, c => c.toUpperCase());
      items.push({ '@type':'ListItem', position: i + 2, name: niceName, item: acc });
    });
    injectJSONLD({
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: items
    });
  })();

  // 5b. Product schema — populated by product.html once product is loaded.
  // product.html should set:  window.__SEO_PRODUCT = {id,name,description,image_url,price,offer_price,sku,brand,gst_percent,in_stock,rating,reviews_count}
  // then dispatch:             window.dispatchEvent(new Event('seo:product-ready'))
  window.addEventListener('seo:product-ready', function () {
    const p = window.__SEO_PRODUCT;
    if (!p) return;
    const price = (p.offer_price && p.offer_price < p.price) ? p.offer_price : p.price;
    const availability = (p.in_stock === false) ? 'https://schema.org/OutOfStock' : 'https://schema.org/InStock';
    const productSchema = {
      '@context': 'https://schema.org',
      '@type': 'Product',
      '@id': location.href + '#product',
      name: p.name,
      description: p.description || desc,
      image: (Array.isArray(p.images) && p.images.length ? p.images : [p.image_url || OGIMG]),
      sku: p.sku || p.id,
      brand: { '@type': 'Brand', name: p.brand || 'ONCOST' },
      offers: {
        '@type': 'Offer',
        url: location.href,
        priceCurrency: 'INR',
        price: String(price || 0),
        availability,
        itemCondition: 'https://schema.org/NewCondition',
        seller: { '@id': SITE + '/#organization' },
        priceValidUntil: new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10)
      }
    };
    if (p.rating && p.reviews_count) {
      productSchema.aggregateRating = {
        '@type': 'AggregateRating',
        ratingValue: String(p.rating),
        reviewCount: String(p.reviews_count)
      };
    }
    injectJSONLD(productSchema);
    // Refresh OG meta for this product
    setMeta('property', 'og:type',        'product');
    setMeta('property', 'og:title',       p.name + ' · ONCOST');
    setMeta('property', 'og:description', (p.description || desc).slice(0, 200));
    setMeta('property', 'og:image',       p.image_url || OGIMG);
    setMeta('property', 'product:price:amount',    String(price || 0));
    setMeta('property', 'product:price:currency',  'INR');
  });
})();
