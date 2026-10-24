# Resinate

The website for **Resinate**, a small handmade resin studio: epoxy and UV resin pieces, poured to order. Published with GitHub Pages at **https://lucky40802.github.io/Resinate/**.

## What's on the site
- **Shop:** what Resinate is and how a piece is made, the four sizes (Small, Medium, Large, XL), add-on prices by size, a builder that prices a piece as you go, and an order form that holds several pieces.
- **Checkout:** customers place an order and get a reference (like `RSN-AB12C`), the amount to pay, and the PayID or bank details to pay with. Custom inclusions and XL sparkle get a confirmed price from the team first.
- **Track order:** customers check an order with its reference and the phone, email or Instagram they ordered with.
- **Our work:** a photo gallery the team uploads to.
- **Team dashboard** (`#dashboard`, or "Team sign-in" at the bottom of the page):
  - Sign-in with an emailed link.
  - Live orders, money received and owed, charts, and a list of what to make.
  - Setting prices for custom work, recording payments (PayID, cash or card), copying messages for customers, and a spreadsheet export.
  - Editors also change prices (including the bundle discount), payment details, photos and the team list.

## Files
| File | What it is |
|---|---|
| `index.html` | The whole site: shop and dashboard |
| `config.js` | The Supabase project and the contact links shown to customers. Edit this to add your Instagram, email or phone |
| `supabase/setup.sql` | The database: tables, row-level security, order pricing and lookup functions, and the photo bucket. Safe to run again after an update |
| `vendor/supabase.js` | supabase-js 2.117.2 |
| `.nojekyll` | Tells GitHub Pages to serve the files as they are |

## Setup
1. **GitHub Pages:** Settings → Pages → Source "Deploy from a branch" → `main`, `/ (root)` → Save.
2. **Database:** run `supabase/setup.sql` in the Supabase project's SQL Editor (the dashboard shows this step, with a copy button, until it's done).
3. **Sign-in links:** in Supabase, Authentication → URL Configuration, set **Site URL** to `https://lucky40802.github.io/Resinate/` and add the same address under **Redirect URLs**. Without this, the emailed sign-in link opens the wrong address.
4. **Team:** sign in at `#dashboard`. The first editor is added with one SQL line that the page shows you. Add everyone else from the dashboard's **Team** section.
5. **Payment details:** fill them in on the dashboard, so customers see where to pay.

Supabase's built-in email sender only sends a few emails an hour. For a whole team, add your own sender under Authentication → SMTP Settings.

## How the data is protected
- Anyone can read prices, payment details and gallery photos.
- Customers can't read or change orders. They place one through `resinate_place_order()`, which prices it on the server so the page can't set its own price, payments or status. They look one up through `resinate_order_status()`, which needs the reference and the matching contact and never returns a name or contact.
- Only emails in `resinate_staff` can see or change orders. Only editors can change settings, photos and the team.

Prices live in the database. The defaults are in both `index.html` and `private.resinate_quote()` in `supabase/setup.sql`; change both if you change a default. Payments are checked by hand against the bank account; there's no card processing.
