# Resinate

The website for **Resinate**, a small handmade resin studio: epoxy and UV resin pieces, poured to order. Published with GitHub Pages at **https://lucky40802.github.io/Resinate/**.

## What's on the site
- **Shop:** what Resinate is and how a piece is made, the four sizes (Small about 100 ml, Medium about 150 ml, Large about 250 ml, XL about 400 ml), the themed designs (priced between a plain pour and a custom design, colours included; makers edit them and add photos on the dashboard) and the designer, where signed-in customers upload their own picture and words and see them on the preview, add-on prices by size, a builder that prices a piece as you go (with a live preview and a colour picker, so makers see exactly which colours were chosen), and an order form that holds several pieces. On phones, a bar at the bottom keeps the order total and a checkout button in reach.
- **Checkout:** customers place an order and get a reference (like `RSN-AB12C`), the amount to pay, and the PayID or bank details to pay with. Custom inclusions and XL sparkle get a confirmed price from the team first.
- **Message us:** a contact form; messages go straight to the maker dashboard (live), with a Reply button that opens an email, text or Instagram. The site also shows the phone number and email from `config.js`.
- **Track order:** customers check an order with its reference and the phone, email or Instagram they ordered with.
- **Our work:** a photo gallery the makers upload to.
- **Accounts** (sign in with an emailed link, no password): anyone can make one.
  - **Profile:** photo (cropped to a square on the device), name, contact for orders, and every order placed while signed in, with its progress and what's left to pay.
  - **Settings:** theme (system, light or dark), a still version of the home-page animation, filling in your details at checkout, remembering orders on the device, clearing the device, signing out (here or everywhere), and deleting the account.
- **Pre-orders:** every order is a pre-order; pieces are poured after they're ordered.
- **Privacy & regulations** (`#policies`): all profit goes to charity, refunds within 7 days of buying (on top of Australian Consumer Law rights), and the privacy policy.
- **Maker dashboard** (`#dashboard`), only for accounts with the `maker` role:
  - Messages from the site (New / Replied / Done), live orders, money received and owed, charts, and a list of what to make.
  - Setting prices for custom work, recording payments (PayID, cash or card), copying messages for customers, and a spreadsheet export.
  - Prices (including the bundle discount), themed designs, payment details and gallery photos.
  - To log an order taken in person (say at the stall), build it in the shop while signed in as a maker and place it with the customer's name and contact.

## Files
| File | What it is |
|---|---|
| `index.html` | The pages and styles: shop, sign-in, profile, settings, privacy & regulations and the maker dashboard |
| `app.js` | Everything the site does (kept out of the page so the security policy can block injected scripts) |
| `theme.js` | Applies a saved light or dark theme before the page draws |
| `config.js` | The Supabase project and the contact links shown to customers. Edit this to add your Instagram, email or phone |
| `supabase/setup.sql` | The database: tables, row-level security, order pricing and lookup functions, and the photo bucket. Safe to run again after an update |
| `vendor/supabase.js` | supabase-js 2.117.2 |
| `.nojekyll` | Tells GitHub Pages to serve the files as they are |

## Setup
1. **GitHub Pages:** Settings → Pages → Source "Deploy from a branch" → `main`, `/ (root)` → Save.
2. **Database:** run `supabase/setup.sql` in the Supabase project's SQL Editor (the dashboard shows this step, with a copy button, until it's done).
3. **Sign-in links:** in Supabase, Authentication → URL Configuration, set **Site URL** to `https://lucky40802.github.io/Resinate/` and add the same address under **Redirect URLs**. Without this, the emailed sign-in link opens the wrong address.
4. **Makers:** roles can only be changed in the Supabase console. The person signs up on the site first, then in the SQL Editor run
   `update public.resinate_profiles set role = 'maker' where email = 'their@email.com';`
   (or set `role` in Table Editor → `resinate_profiles`). Use `'customer'` to take it away. To make someone a maker before they sign up, add their email to `resinate_staff`.
5. **Payment details:** fill them in on the dashboard, so customers see where to pay.

Supabase's built-in email sender only sends a few emails an hour. For a whole team, add your own sender under Authentication → SMTP Settings.

## How the data is protected
- Everything travels over HTTPS (GitHub Pages and Supabase), and Supabase encrypts the stored data.
- A Content-Security-Policy lets the page run only its own scripts and talk only to this Supabase project, which blocks injected scripts. Customer text is always escaped before it's shown.
- Customers can upload pictures only into their own `designs/<account id>/` folder; the bucket takes images only, up to 10 MB, and order items keep only paths that match that folder.
- Anyone can read prices, payment details and gallery photos.
- Customers can't change orders. They place one through `resinate_place_order()`, which prices it on the server so the page can't set its own price, payments or status. They look one up through `resinate_order_status()`, which needs the reference and the matching contact and never returns a name or contact.
- Every account has a row in `resinate_profiles`. People can change their own name, contact and photo, but not their role or email: the database only lets them update those three columns.
- Signed-in customers can read their own orders. Only makers can see every order or change one, and only makers can change settings and gallery photos.
- Profile photos live under `avatars/<account id>/` in the `resinate` bucket; each person can only add, replace or remove their own.

Prices live in the database. The defaults are in both `index.html` and `private.resinate_quote()` in `supabase/setup.sql`; change both if you change a default. Payments are checked by hand against the bank account; there's no card processing.
