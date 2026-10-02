# বাজার নজর

ঢাকা মহানগরীর খুচরা বাজারদর, [tcb.gov.bd](https://tcb.gov.bd/pages/daily-rmps)-এর দৈনিক Excel প্রতিবেদন থেকে সংগ্রহ করা।

## চালু করা (Vercel)

1. এই রিপোটা GitHub-এ পুশ করুন
2. [vercel.com](https://vercel.com) → **Add New Project** → এই রিপো ইম্পোর্ট করুন → **Deploy** (Framework: Other/Static, কোনো build command লাগবে না)
3. ব্যস — `index.html` আর `data.json` সরাসরি সার্ভ হবে

## দৈনিক আপডেট (GitHub Actions)

`.github/workflows/update-prices.yml` প্রতিদিন সকাল ৯টায় (Asia/Dhaka) চলে:
- TCB-র নতুন Excel (.xlsx) ফাইল ডাউনলোড করে
- দাম বের করে `data.json` আপডেট করে
- বদলে থাকলে সরাসরি `main`-এ commit করে (Vercel অটো-রিডিপ্লয় করে)

**সেফটি:** TCB-র Excel ফাইল পরিষ্কার স্ট্রাকচার্ড ডেটা দেয়। প্রত্যাশিত সংখ্যক পণ্যের চেয়ে অনেক কম পাওয়া গেলে স্ক্রিপ্ট কিছুই না লিখে থেমে যায়, ফলে ভুল ডেটা লাইভ হওয়ার ঝুঁকি কম। কোনো দিন ফরম্যাট বদলালে workflow ফেইল করবে, সাইটে আগের দিনের ডেটাই থাকবে।

ম্যানুয়ালি এখনই একবার চালাতে চাইলে: GitHub রিপোর "Actions" ট্যাব → "Update bazar prices" → "Run workflow"।

**একটা টেকনিক্যাল নোট:** tcb.gov.bd (ও dam.gov.bd, একই সরকারি হোস্টিং প্ল্যাটফর্ম) সার্ভার সাইডে SSL সার্টিফিকেট চেইন অসম্পূর্ণভাবে কনফিগার করা — তাই স্ক্রিপ্টে এই নির্দিষ্ট সাইটের জন্য certificate verification শিথিল করা আছে (`scripts/scrape.js`-এ `rejectUnauthorized: false`), শুধু এই দুটো রিকোয়েস্টের জন্য, পুরো স্ক্রিপ্টের জন্য না। এটা একটা পাবলিক সরকারি ফাইল পড়ছে বলে ঝুঁকি কম, কিন্তু জেনে রাখা ভালো।

## লোকালি চালানো

```bash
npm install
npm run scrape   # data.json আপডেট করবে
npx serve .      # লোকালি প্রিভিউ দেখতে
```
