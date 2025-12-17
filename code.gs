/*
  Google Apps Script: code.gs
  Purpose: receive orders (POST), store them in a sheet named "Orders" in the bound spreadsheet,
           send a confirmation email to the customer, and return a JSON response.

  Usage / Deployment:
  1. Attach this script to the Google Sheet where you want orders recorded (Script Editor -> New Project).
  2. Save the script, run the `setupOrdersSheet` function once to create the `Orders` sheet and headers.
  3. Deploy -> New deployment -> Web app.
     - Execute as: Me
  - Who has access: Anyone (even anonymous)  <-- if you want public checkout from a website
  4. Use the deployment URL as the POST endpoint in your frontend.

  Security note:
  - If you set access to "Anyone, even anonymous" the endpoint will accept public POSTs. If you want to protect it,
    deploy with a more restrictive access and use oAuth or add a shared secret that the frontend sends.

  Expected POST payload (JSON):
  {
    "name": "Customer Name",
    "email": "customer@example.com",
    "phone": "555-1234",            // optional
    "cart": [                         // cart items
       { "name": "Bangle Bracelets", "quantity": 2, "totalPrice": 26.00, "customization": "1, 2" },
       { "name": "AnnaKate Blood Drop Necklace", "quantity": 1, "totalPrice": 15.00 }
    ],
    "appliedPromo": false,
    "selectedPackaging": "standard", // or 'premium'
    "selectedShipping": "central",  // or 'home'
    "paymentMethod": "venmo"         // or 'cash'
  }
*/

const SHEET_NAME = 'Orders';

function setupOrdersSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME);
  const headers = [
    'Order ID',
    'Date',
    'Customer Name',
    'Email',
    'Phone',
    'Address Line 1',
    'Address Line 2',
    'City',
    'State',
    'ZIP',
    'Country',
    'Items (JSON)',
    'Items (Readable)',
    'Subtotal',
    'Applied Promo',
    'Packaging',
    'Shipping',
    'Payment Method',
    'Status',
    'Notes'
  ];
  sheet.clear();
  sheet.appendRow(headers);
}

function doGet(e) {
  // Basic health check / info
  const info = {
    status: 'ok',
    message: 'Orders web app is running. Use POST to submit orders.'
  };
  return ContentService
    .createTextOutput(JSON.stringify(info))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  // Accept POST with JSON body containing order details
  try {
    if (!e || !e.postData || !e.postData.contents) {
      Logger.log('doPost: no postData or empty contents');
      return jsonResponse({ success: false, error: 'No POST data received.' }, 400);
    }

    Logger.log('doPost received: ' + e.postData.contents);
    let payload = null;
    try {
      payload = JSON.parse(e.postData.contents);
    } catch (parseErr) {
      Logger.log('JSON parse error: ' + parseErr);
      return jsonResponse({ success: false, error: 'Invalid JSON payload: ' + String(parseErr) }, 400);
    }

    // Minimal validation
    if (!payload || !payload.cart || !Array.isArray(payload.cart) || payload.cart.length === 0) {
      return jsonResponse({ success: false, error: 'Cart is empty or missing.' }, 400);
    }
    if (!payload.email) {
      return jsonResponse({ success: false, error: 'Customer email is required.' }, 400);
    }
    if (!payload.paymentMethod) {
      return jsonResponse({ success: false, error: 'Payment method is required.' }, 400);
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) {
      // Create sheet with headers if missing
      sheet = ss.insertSheet(SHEET_NAME);
      setupOrdersSheet();
      sheet = ss.getSheetByName(SHEET_NAME);
    }

    // Compute subtotal from cart (trusting frontend totals but compute as a safety fallback)
    let subtotal = 0;
    payload.cart.forEach(item => {
      if (typeof item.totalPrice === 'number') {
        subtotal += item.totalPrice;
      } else if (typeof item.price === 'number' && typeof item.quantity === 'number') {
        subtotal += item.price * item.quantity;
      }
    });
    subtotal = Number(subtotal.toFixed(2));

    const appliedPromo = !!payload.appliedPromo;
    const packaging = payload.selectedPackaging || '';
    const shipping = payload.selectedShipping || '';
    const paymentMethod = payload.paymentMethod;

    const orderId = `ORD-${new Date().getTime()}`;
    const dateStr = new Date().toISOString();

    const itemsJson = JSON.stringify(payload.cart);

    // Extract address fields if provided
    const addr = payload.address || {};
    const addressLine1 = addr.line1 || '';
    const addressLine2 = addr.line2 || '';
    const addressCity = addr.city || '';
    const addressState = addr.state || '';
    const addressZip = addr.zip || '';
    const addressCountry = addr.country || '';

    // Produce a readable items string for the sheet
    const itemsReadable = payload.cart.map(it => {
      const parts = [];
      parts.push(`${it.name}`);
      if (it.customization) parts.push(`(${it.customization})`);
      parts.push(`x${it.quantity || 1}`);
      parts.push(`$${(it.totalPrice || ((it.price || 0) * (it.quantity || 1))).toFixed(2)}`);
      return parts.join(' ');
    }).join(' | ');

    const notes = payload.notes || '';

    // Append row to sheet
    const row = [
      orderId,
      dateStr,
      payload.name || '',
      payload.email,
      payload.phone || '',
      addressLine1,
      addressLine2,
      addressCity,
      addressState,
      addressZip,
      addressCountry,
      itemsJson,
      itemsReadable,
      subtotal,
      appliedPromo ? 'YES' : 'NO',
      packaging,
      shipping,
      paymentMethod,
      'RECEIVED',
      notes
    ];

    sheet.appendRow(row);
    Logger.log('Order appended: ' + orderId + ' email=' + (payload.email||''));

    // Send confirmation email to the customer
    const receiptText = buildReceiptText({
      orderId,
      dateStr,
      name: payload.name || '',
      email: payload.email,
      phone: payload.phone || '',
      address: addr,
      cart: payload.cart,
      subtotal,
      appliedPromo,
      packaging,
      shipping,
      paymentMethod
    });

    const subject = `The Cure Collection - Order Confirmation (${orderId})`;
    try {
      const receiptHtml = buildReceiptHtml({
        orderId,
        dateStr,
        name: payload.name || '',
        email: payload.email,
        phone: payload.phone || '',
        address: addr,
        cart: payload.cart,
        subtotal,
        appliedPromo,
        packaging,
        shipping,
        paymentMethod
      });

      MailApp.sendEmail({
        to: payload.email,
        subject: subject,
        body: receiptText,
        htmlBody: receiptHtml
      });
    } catch (mailErr) {
      // Mail failure is non-fatal for storing the order
      console.error('Mail send failed:', mailErr);
    }

    return jsonResponse({ success: true, orderId: orderId, message: 'Order recorded and confirmation email sent (if mail allowed).' });

  } catch (err) {
    console.error('doPost error:', err);
    return jsonResponse({ success: false, error: String(err) }, 500);
  }
}

function buildReceiptText(order) {
  let text = '';
  text += `THE CURE COLLECTION\n`;
  text += `Order ID: ${order.orderId}\n`;
  text += `Date: ${new Date(order.dateStr).toLocaleString()}\n\n`;
  text += `Customer: ${order.name || 'Guest'}\n`;
  if (order.phone) text += `Phone: ${order.phone}\n`;
  text += `Email: ${order.email}\n\n`;
  if (order.address && (order.address.line1 || order.address.city || order.address.zip)) {
    text += `SHIPPING / BILLING ADDRESS:\n`;
    if (order.address.line1) text += `${order.address.line1}\n`;
    if (order.address.line2) text += `${order.address.line2}\n`;
    const cityPart = `${order.address.city || ''}`;
    const statePart = order.address.state ? `, ${order.address.state}` : '';
    const zipPart = order.address.zip ? ` ${order.address.zip}` : '';
    if (cityPart || statePart || zipPart) text += `${cityPart}${statePart}${zipPart}\n`;
    if (order.address.country) text += `${order.address.country}\n`;
    text += `\n`;
  }
  text += `ORDER DETAILS:\n`;

  order.cart.forEach(item => {
    const linePrice = (typeof item.totalPrice === 'number') ? item.totalPrice : ((item.price || 0) * (item.quantity || 1));
    text += `- ${item.name}`;
    if (item.customization) text += ` (${item.customization})`;
    text += ` x${item.quantity || 1} — $${Number(linePrice).toFixed(2)}\n`;
  });

  text += `\nSubtotal: $${Number(order.subtotal).toFixed(2)}\n`;
  if (order.packaging && order.packaging === 'premium') {
    text += `Premium Packaging: $20.00\n`;
  }
  if (order.shipping && order.shipping === 'home') {
    text += `Home Delivery: $5.00\n`;
  }
  if (order.appliedPromo) {
    const discount = Number(order.subtotal) * 0.1;
    text += `Promo (10%): -$${discount.toFixed(2)}\n`;
  }

  // compute final total (note: packaging/shipping amounts are client-side choices; mirror client logic)
  let packagingCost = (order.packaging === 'premium') ? 20 : 0;
  let shippingCost = (order.shipping === 'home') ? 5 : 0;
  let discount = order.appliedPromo ? (Number(order.subtotal) * 0.1) : 0;
  let finalTotal = Number(order.subtotal) - discount + packagingCost + shippingCost;
  text += `TOTAL: $${finalTotal.toFixed(2)}\n\n`;

  text += `Payment Method: ${order.paymentMethod.toUpperCase()}\n`;
  if (order.paymentMethod === 'venmo') {
    text += `\nPlease send payment to Venmo: @Brewsters6 and include Order ID ${order.orderId} in the payment note.\n`;
  } else if (order.paymentMethod === 'cash') {
    text += `\nYour order will be paid in cash at pickup/delivery.\n`;
  } else if (order.paymentMethod === 'revtrak') {
    text += `\nREVTRAK PAYMENT INSTRUCTIONS:\n`;
    text += `1. Go to: https://pewaukee.revtrak.net/donations-and-fundraisers/global-business-treasure-trove/\n`;
    text += `2. Enter your order amount: $${finalTotal.toFixed(2)}\n`;
    text += `3. Complete the payment\n`;
    text += `4. Take a screenshot or forward the receipt email to: brewsam26@Pewaukeeschools.org\n`;
    text += `5. Include your Order ID: ${order.orderId}\n`;
  }

  text += `\nThank you for supporting blood cancer warriors!\n`;
  text += `The Cure Collection\n`;
  return text;
}

function buildReceiptHtml(order) {
  // Inline CSS for email
  const style = `
    body { font-family: Arial, Helvetica, sans-serif; color: #333; }
    .container { max-width: 680px; margin: 0 auto; padding: 18px; }
    .header { text-align: left; border-bottom: 1px solid #eee; padding-bottom: 12px; margin-bottom: 18px; }
    .logo { font-size: 20px; font-weight: 700; color: #8b0000; }
    .muted { color: #666; font-size: 13px; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; }
    th, td { padding: 8px 10px; border-bottom: 1px solid #eee; text-align: left; }
    th { background: #fafafa; font-weight: 700; }
    .right { text-align: right; }
    .total-row { font-weight: 700; font-size: 16px; }
    .note { background: #f9f9f9; padding: 10px; border-radius: 6px; margin-top: 12px; }
    .footer { margin-top: 18px; font-size: 13px; color: #666; }
  `;

  const orderDate = new Date(order.dateStr).toLocaleString();

  const itemsRows = (order.cart || []).map(item => {
    const opts = item.customization ? `<div class="muted">${escapeHtml(item.customization)}</div>` : '';
    const qty = item.quantity || 1;
    const price = Number(item.totalPrice || ((item.price || 0) * qty)).toFixed(2);
    return `<tr>
      <td>${escapeHtml(item.name)}${opts}</td>
      <td class="right">${qty}</td>
      <td class="right">$${price}</td>
    </tr>`;
  }).join('');

  const packagingLine = order.packaging === 'premium' ? `<tr><td>Premium Packaging</td><td></td><td class="right">$20.00</td></tr>` : '';
  const shippingLine = order.shipping === 'home' ? `<tr><td>Home Delivery</td><td></td><td class="right">$5.00</td></tr>` : '';
  const discountLine = order.appliedPromo ? `<tr><td>Promo (10%)</td><td></td><td class="right">-${(Number(order.subtotal) * 0.1).toFixed(2)}</td></tr>` : '';

  const packagingCost = order.packaging === 'premium' ? 20 : 0;
  const shippingCost = order.shipping === 'home' ? 5 : 0;
  const discount = order.appliedPromo ? (Number(order.subtotal) * 0.1) : 0;
  const finalTotal = Number(order.subtotal) - discount + packagingCost + shippingCost;

  let paymentInstruction = '';
  if (order.paymentMethod === 'venmo') {
    paymentInstruction = `<p>Please send payment to <strong>@Brewsters6</strong> on Venmo and include <strong>Order ID ${escapeHtml(order.orderId)}</strong> in the payment note.</p>`;
  } else if (order.paymentMethod === 'cash') {
    paymentInstruction = `<p>Pay with cash at pickup or delivery. Please bring exact change if possible.</p>`;
  } else if (order.paymentMethod === 'revtrak') {
    const packagingCost = order.packaging === 'premium' ? 20 : 0;
    const shippingCost = order.shipping === 'home' ? 5 : 0;
    const discount = order.appliedPromo ? (Number(order.subtotal) * 0.1) : 0;
    const finalTotal = Number(order.subtotal) - discount + packagingCost + shippingCost;
    paymentInstruction = `
      <div style="background: #fff3cd; border: 1px solid #ffc107; border-radius: 6px; padding: 12px; margin-top: 12px;">
        <h3 style="color: #856404; margin-bottom: 8px;">Revtrak Payment Instructions</h3>
        <ol style="margin-left: 20px; line-height: 1.8; color: #856404;">
          <li>Go to: <a href="https://pewaukee.revtrak.net/donations-and-fundraisers/global-business-treasure-trove/" style="color: #e67e22;">Revtrak Payment Portal</a></li>
          <li>Enter your order amount: <strong>$${finalTotal.toFixed(2)}</strong></li>
          <li>Complete the payment</li>
          <li>Take a screenshot or forward the receipt email to: <strong>brewsam26@Pewaukeeschools.org</strong></li>
          <li>Include your Order ID: <strong>${escapeHtml(order.orderId)}</strong></li>
        </ol>
      </div>
    `;
  }

  const html = `<!doctype html>
  <html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>${style}</style>
  </head>
  <body>
    <div class="container">
      <div class="header">
        <div class="logo">The Cure Collection</div>
        <div class="muted">Order Confirmation — <strong>${escapeHtml(order.orderId)}</strong></div>
        <div class="muted">Date: ${escapeHtml(orderDate)}</div>
      </div>

      <div>
        <strong>Customer</strong>
        <div>${escapeHtml(order.name || '')}</div>
        <div class="muted">${escapeHtml(order.email || '')}${order.phone ? ' • ' + escapeHtml(order.phone) : ''}</div>
        ${order.address && (order.address.line1 || order.address.city || order.address.zip) ? `
          <div style="margin-top:8px;"><strong>Address</strong>
            <div>${escapeHtml(order.address.line1 || '')}</div>
            ${order.address.line2 ? `<div>${escapeHtml(order.address.line2)}</div>` : ''}
            <div class="muted">${escapeHtml(order.address.city || '')}${order.address.state ? ', ' + escapeHtml(order.address.state) : ''}${order.address.zip ? ' ' + escapeHtml(order.address.zip) : ''}</div>
            <div class="muted">${escapeHtml(order.address.country || '')}</div>
          </div>
        ` : ''}
      </div>

      <table aria-labelledby="order-summary">
        <thead>
          <tr><th>Item</th><th class="right">Qty</th><th class="right">Price</th></tr>
        </thead>
        <tbody>
          ${itemsRows}
          <tr><td>Subtotal</td><td></td><td class="right">$${Number(order.subtotal).toFixed(2)}</td></tr>
          ${packagingLine}
          ${shippingLine}
          ${discountLine}
          <tr class="total-row"><td>TOTAL</td><td></td><td class="right">$${finalTotal.toFixed(2)}</td></tr>
        </tbody>
      </table>

      <div class="note">
        <strong>Payment Method:</strong> ${escapeHtml((order.paymentMethod || '').toUpperCase())}
        ${paymentInstruction}
      </div>

      <div class="footer">
        <p>Thank you for supporting blood cancer warriors. 20% of profits are donated to Blood Cancer United.</p>
        <p>If you have any questions about your order please reply to this email.</p>
      </div>
    </div>
  </body>
  </html>`;

  return html;
}

function escapeHtml(str) {
  if (!str && str !== 0) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function jsonResponse(obj, status) {
  const resp = ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
  // Apps Script does not support setting arbitrary response headers from ContentService, but
  // when deployed as a web app with "Anyone, even anonymous" it typically works from browser fetch.
  return resp;
}
