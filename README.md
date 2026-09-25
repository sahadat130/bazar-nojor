# বাজার নজর

ঢাকা মহানগরীর খুচরা বাজারদর, [dam.gov.bd](https://dam.gov.bd/pages/marketprice)-এর দৈনিক প্রতিবেদন থেকে সংগ্রহ করা।

## চালু করা (Vercel)

1. এই রিপোটা GitHub-এ পুশ করুন
2. [vercel.com](https://vercel.com) → **Add New Project** → এই রিপো ইম্পোর্ট করুন → **Deploy** (Framework: Other/Static, কোনো build command লাগবে না)
3. ব্যস — `index.html` আর `data.json` সরাসরি সার্ভ হবে

## দৈনিক আপডেট (GitHub Actions)

`.github/workflows/update-prices.yml` প্রতিদিন সকাল ৯টায় (Asia/Dhaka) চলে:
- DAM-এর নতুন PDF ডাউনলোড করে
- দাম বের করে `data.json` আপডেট করে
- **সরাসরি মেইন ব্রাঞ্চে পুশ করে না** — একটা Pull Request খোলে

**কেন PR, ডাইরেক্ট পুশ না:** DAM-এর PDF-এ পণ্যের নাম পুরনো একটা বাংলা এনকোডিং-এ থাকায় স্বয়ংক্রিয় পার্সিং কখনো ১০০% নির্ভুল না। তাই প্রতিদিনের আপডেট একটা PR হিসেবে আসে, Vercel সেই PR-এর জন্য একটা প্রিভিউ লিংক বানায়, আপনি একবার চোখ বুলিয়ে ঠিক থাকলে merge করবেন। যেসব পণ্যের দাম স্ক্রিপ্ট নিশ্চিত হতে পারেনি সেগুলো অপরিবর্তিত রেখে GitHub Actions-এর লগে ফ্ল্যাগ করে দেয়।

ম্যানুয়ালি এখনই একবার চালাতে চাইলে: GitHub রিপোর "Actions" ট্যাব → "Update bazar prices" → "Run workflow"।

## লোকালি চালানো

```bash
npm install
npm run scrape   # data.json আপডেট করবে
npx serve .      # লোকালি প্রিভিউ দেখতে
```
