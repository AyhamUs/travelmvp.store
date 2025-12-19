// Travel MVP Order Processing Script
// Deploy this as a Web App in Google Apps Script

// CONFIGURATION - Update these values
const SPREADSHEET_ID = '1dNj3I18sH4C7TR8r4-Mu4vaLMkUJScbKguwHGc0yNuU'; // Get from spreadsheet URL
const SHEET_NAME = 'Orders';
const EMAIL_FROM_NAME = 'Travel MVP';

// Main function to handle POST requests
function doPost(e) {
  try {
    const orderData = JSON.parse(e.postData.contents);
    
    // Add order to spreadsheet
    addOrderToSheet(orderData);
    
    // Send confirmation email
    sendConfirmationEmail(orderData);
    
    // Build response; include Revtrak payment instructions when applicable
    const responseObj = {
      status: 'success',
      orderNumber: orderData.orderNumber
    };

    if (orderData.paymentMethod === 'revtrak') {
      const revtrakUrl = 'https://pewaukee.revtrak.net/donations-and-fundraisers/global-business-treasure-trove/';
      responseObj.paymentInstructions = {
        provider: 'revtrak',
        url: revtrakUrl,
        amount: '$' + orderData.total.toFixed(2),
        orderId: orderData.orderNumber,
        text: `Revtrak Payment Instructions\nGo to: Revtrak Payment Portal (${revtrakUrl})\nEnter your order amount: $${orderData.total.toFixed(2)}\nComplete the payment\nTake a screenshot or forward the receipt email to: rhoalia26@Pewaukeeschools.org\nInclude your Order ID: ${orderData.orderNumber}`
      };
    }

    return ContentService.createTextOutput(JSON.stringify(responseObj)).setMimeType(ContentService.MimeType.JSON);
    
  } catch (error) {
    Logger.log('Error processing order: ' + error.toString());
    return ContentService.createTextOutput(JSON.stringify({
      status: 'error',
      message: error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

// Add order to Google Sheet
function addOrderToSheet(orderData) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(SHEET_NAME);
  
  // Create sheet if it doesn't exist
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    // Add headers
    sheet.appendRow([
      'Order Number',
      'Order Date',
      'Customer Name',
      'Customer Email',
      'Customer Phone',
      'Shipping Address',
      'Payment Method',
      'Number of Bags',
      'Order Details',
      'Total Amount',
      'Status'
    ]);
    
    // Format header row
    const headerRange = sheet.getRange(1, 1, 1, 11);
    headerRange.setFontWeight('bold');
    headerRange.setBackground('#4285f4');
    headerRange.setFontColor('#ffffff');
  }
  
  // Format order details
  let orderDetails = '';
  orderData.bags.forEach(bag => {
    const bagColor = bag.color ? ` (${bag.color.charAt(0).toUpperCase() + bag.color.slice(1)})` : '';
    orderDetails += `Bag #${bag.id}${bagColor}: `;
    if (bag.addons.length > 0) {
      const addonNames = bag.addons.map(addon => `${addon.name} ($${addon.price.toFixed(2)})`).join(', ');
      orderDetails += addonNames;
    } else {
      orderDetails += 'Base bag only';
    }
    orderDetails += ` | Subtotal: $${bag.total.toFixed(2)}\n`;
  });
  
  // Add new order row
  sheet.appendRow([
    orderData.orderNumber,
    new Date(orderData.orderDate),
    orderData.customerName,
    orderData.customerEmail,
    orderData.customerPhone,
    orderData.customerAddress,
    orderData.paymentMethod.toUpperCase(),
    orderData.bags.length,
    orderDetails.trim(),
    '$' + orderData.total.toFixed(2),
    'Pending'
  ]);
  
  // Auto-resize columns
  sheet.autoResizeColumns(1, 11);
}

// Send confirmation email to customer
function sendConfirmationEmail(orderData) {
  const subject = `Order Confirmation - ${orderData.orderNumber}`;
  
  // Build order details HTML
  let bagsHtml = '';
  orderData.bags.forEach(bag => {
    const bagColor = bag.color ? ` (${bag.color.charAt(0).toUpperCase() + bag.color.slice(1)})` : '';
    bagsHtml += `
      <div style="margin-bottom: 15px; padding: 15px; background-color: #f8f9fa; border-left: 4px solid #4285f4;">
        <strong>Bag #${bag.id}${bagColor} - $${bag.total.toFixed(2)}</strong><br>
        <ul style="margin: 10px 0; padding-left: 20px;">
          <li>Base Travel Bag - $7.00</li>
    `;
    
    bag.addons.forEach(addon => {
      bagsHtml += `<li>${addon.name} - $${addon.price.toFixed(2)}</li>`;
    });
    
    bagsHtml += `
        </ul>
      </div>
    `;
  });
  
  // Payment instructions based on method (supports venmo, revtrak, cash)
  let paymentInfo = '';
  if (orderData.paymentMethod === 'revtrak') {
    const revtrakUrl = 'https://pewaukee.revtrak.net/donations-and-fundraisers/global-business-treasure-trove/';
    paymentInfo = `
      <div style="background-color: #fff3e0; padding: 15px; border-radius: 5px; margin: 20px 0;">
        <strong style="color: #e65100;">Revtrak Payment Instructions</strong><br>
        <p style="margin:6px 0">Go to: <a href="${revtrakUrl}" target="_blank">Revtrak Payment Portal</a></p>
        <p style="margin:6px 0">Enter your order amount: <strong>$${orderData.total.toFixed(2)}</strong></p>
        <p style="margin:6px 0">Complete the payment on the Revtrak site.</p>
        <p style="margin:6px 0">Take a screenshot or forward the receipt email to: <strong>rhoalia26@pewaukeeschools.org</strong></p>
        <p style="margin:6px 0">Include your Order ID: <strong>${orderData.orderNumber}</strong></p>
      </div>
    `;
  } else if (orderData.paymentMethod === 'venmo') {
    paymentInfo = `
      <div style="background-color: #e3f2fd; padding: 15px; border-radius: 5px; margin: 20px 0;">
        <strong style="color: #1976d2;">Venmo Payment Instructions:</strong><br>
        Please send payment of <strong>$${orderData.total.toFixed(2)}</strong> to: <strong>@TravelMVP</strong><br>
        Include your email <strong>${orderData.customerEmail}</strong> in the payment note.
      </div>
    `;
  } else {
    paymentInfo = `
      <div style="background-color: #f1f8e9; padding: 15px; border-radius: 5px; margin: 20px 0;">
        <strong style="color: #558b2f;">Cash Payment:</strong><br>
        You have selected to pay cash on delivery. Please have <strong>$${orderData.total.toFixed(2)}</strong> ready when you receive your order.
      </div>
    `;
  }
  
  const htmlBody = `
    <html>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #4285f4; margin-bottom: 10px;">Thank You for Your Order!</h1>
            <p style="font-size: 18px; color: #666;">Order #${orderData.orderNumber}</p>
          </div>
          
          <div style="background-color: #ffffff; border: 1px solid #ddd; border-radius: 5px; padding: 20px; margin-bottom: 20px;">
            <h2 style="color: #333; border-bottom: 2px solid #4285f4; padding-bottom: 10px;">Order Details</h2>
            
            <p><strong>Customer:</strong> ${orderData.customerName}</p>
            <p><strong>Email:</strong> ${orderData.customerEmail}</p>
            <p><strong>Phone:</strong> ${orderData.customerPhone}</p>
            <p><strong>Shipping Address:</strong><br>${orderData.customerAddress.replace(/\n/g, '<br>')}</p>
            <p><strong>Order Date:</strong> ${new Date(orderData.orderDate).toLocaleString()}</p>
          </div>
          
          <div style="background-color: #ffffff; border: 1px solid #ddd; border-radius: 5px; padding: 20px; margin-bottom: 20px;">
            <h2 style="color: #333; border-bottom: 2px solid #4285f4; padding-bottom: 10px;">Your Bags</h2>
            ${bagsHtml}
            
            <div style="text-align: right; margin-top: 20px; padding-top: 15px; border-top: 2px solid #333;">
              <span style="font-size: 24px; font-weight: bold; color: #4285f4;">Total: $${orderData.total.toFixed(2)}</span>
            </div>
          </div>
          
          ${paymentInfo}
          
          <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; text-align: center; margin-top: 30px;">
            <p style="margin: 0; color: #666;">Questions about your order? Contact us at rhoalia26@pewaukeeschools.org</p>
            <p style="margin: 10px 0 0 0; color: #999; font-size: 12px;">© 2025 Travel MVP. Pack smart. Travel better.</p>
          </div>
        </div>
      </body>
    </html>
  `;
  
  const plainBody = `
    Thank you for your order!
    
    Order #${orderData.orderNumber}
    
    Customer: ${orderData.customerName}
    Email: ${orderData.customerEmail}
    Phone: ${orderData.customerPhone}
    Shipping Address: ${orderData.customerAddress}
    Order Date: ${new Date(orderData.orderDate).toLocaleString()}
    
    ORDER DETAILS:
    ${orderData.bags.map(bag => {
      const bagColor = bag.color ? ` (${bag.color.charAt(0).toUpperCase() + bag.color.slice(1)})` : '';
      let bagText = `Bag #${bag.id}${bagColor} - $${bag.total.toFixed(2)}\n  - Base Travel Bag - $7.00`;
      bag.addons.forEach(addon => {
        bagText += `\n  - ${addon.name} - $${addon.price.toFixed(2)}`;
      });
      return bagText;
    }).join('\n\n')}
    
    TOTAL: $${orderData.total.toFixed(2)}
    
    Payment Method: ${orderData.paymentMethod.toUpperCase()}
    ${orderData.paymentMethod === 'revtrak' ?
      `\nRevtrak Payment Instructions:\nGo to: https://pewaukee.revtrak.net/donations-and-fundraisers/global-business-treasure-trove/\nEnter your order amount: $${orderData.total.toFixed(2)}\nComplete the payment on the Revtrak site.\nTake a screenshot or forward the receipt email to: rhoalia26@pewaukeeschools.org\nInclude your Order ID: ${orderData.orderNumber}` :
      (orderData.paymentMethod === 'venmo' ?
        `\nPlease send payment to @TravelMVP and include your email (${orderData.customerEmail}) in the note.` :
        `\nYou have selected to pay cash on delivery.`
      )}
    
    Questions? Contact us at rhoalia26@pewaukeeschools.org
    
    © 2025 Travel MVP. Pack smart. Travel better.
  `;
  
  MailApp.sendEmail({
    to: orderData.customerEmail,
    subject: subject,
    body: plainBody,
    htmlBody: htmlBody,
    name: EMAIL_FROM_NAME
  });
}

// Test function - uncomment and run to test email formatting
/*
function testEmail() {
  const testData = {
    orderNumber: 'TMV1234567890',
    customerName: 'John Doe',
    customerEmail: 'your-email@example.com', // Change to your email for testing
    customerPhone: '555-1234',
    customerAddress: '123 Main St\nAnytown, ST 12345',
    paymentMethod: 'venmo',
    bags: [
      {
        id: 1,
        color: 'tan',
        addons: [
          { name: 'Toothbrush/Toothpaste', price: 1.75 },
          { name: 'Degree Womens Deodorant', price: 2.00 }
        ],
        total: 10.75
      },
      {
        id: 2,
        color: 'black',
        addons: [
          { name: 'Hand Sanitizer', price: 3.50 },
          { name: 'Degree Mens Deodorant', price: 2.00 }
        ],
        total: 12.50
      }
    ],
    total: 23.25,
    orderDate: new Date().toISOString()
  };
  
  sendConfirmationEmail(testData);
  Logger.log('Test email sent!');
}
*/
