# מצב הפרויקט — 16 בספטמבר 2026

## חי באוויר
- **אתר**: https://slichot.onrender.com
- **ריפו**: https://github.com/gruto-art/slichot-edot-hamizrach (ענף `main`)
- **Render**: שירות `srv-dal3cs2jnfac73cb8c90`, תוכנית free, פרנקפורט, Docker
- **לוח בקרה**: `/admin` · **סנכרון גבאי**: `/sync` (שניהם דורשים `ADMIN_TOKEN`)

## מה הושלם
- סדר סליחות עדות המזרח מלא ומנוקד: 55 פרקים, 5,357 מילים (ממקור ספריא, תורת אמת)
  - הוסרו לבקשת בעל האתר: "קמתי באשמורת" ו"אנחנו בושנו"
- כל הטקסט מוטמע ב-HTML בצד השרת (SEO ללא תלות ב-JS) + JSON-LD + FAQ + OG
- תוכן שעונה על ניסוחי החיפוש בפועל: תפילת הסליחות, סליחות ספרדי, ערב יום כיפור
- מעקב חי מהכותל: קליטה → חיתוך → תמלול → התאמה → SSE
- מדידת כניסות first-party ב-SQLite + לוח בקרה
- **GA4**: מזהה `G-MJHY3QN9G5`, נכס "סליחות עדות המזרח" (חשבון a347012710) — מותקן ופעיל
- **Search Console**: הבעלות אומתה דרך `public/google9e20222ce48340ed.html`.
  מפת האתר הוגשה (תוקנה מ-56 כתובות עם עוגנים לכתובת אמיתית אחת)

## פתוח
1. **בקשת אינדוקס לדף הבית** — לא הושלמה. Search Console → בדיקת דף →
   הזנת `https://slichot.onrender.com/` → "בקשת אינדוקס".
2. **סטטוס מפת האתר** ב-Search Console הראה "לא ניתן היה לאחזר" מהניסיון הראשון
   (לפני התיקון). לוודא שהתעדכן. הקובץ עצמו מוגש תקין ב-HTTP 200.
3. **יוטיוב חוסמת את Render** — `Sign in to confirm you're not a bot`. בעל האתר
   בחר במסלול העוגיות: לייצא `cookies.txt` מחשבון גוגל חד-פעמי (תוסף
   "Get cookies.txt LOCALLY" בפרופיל Chrome נפרד), להעלות כ-Secret File בשם
   `cookies.txt` ולהגדיר `YTDLP_COOKIES=/etc/secrets/cookies.txt`.
   עד אז המעקב האוטומטי לא עולה, ו-`/sync` הוא המסלול הפעיל.
   חלופה שנבדקה ועובדת: `KOTEL_STREAM_URL` עם כתובת `.m3u8` ישירה
   (+`KOTEL_STREAM_REFERER`) עוקפת את yt-dlp לגמרי.
4. **מפתח ElevenLabs זמני** בקובץ `.env` המקומי — למחוק אותו ב-ElevenLabs.
   בייצור יש מפתח נפרד ב-Render.
5. **Render לא מחובר ל-GitHub** — פריסות לא נורות אוטומטית על push.
   תיקון: דשבורד → Connect. עד אז: `render deploys create srv-dal3cs2jnfac73cb8c90 --confirm`.

## תוצאות בדיקות המעקב
| מקור | קטעים שעוגנו | התקדמות סבירה |
|---|---|---|
| הקלטת בית כנסת (נוסח מרוקאי) | 45/53 (85%) | 43/44 |
| הכותל המערבי (ד׳ בתשרי, הערוץ הרשמי) | 19/50 (38%) | 18/18 |

בכותל רצף הפרקים תאם את הסדר בפועל. האקוסטיקה שם (רחבה פתוחה, קהל, הד)
מורידה את שיעור העיגון, והקידום המשוער נושא את הפער. המעקב טוב לרמת פרק,
לא לרמת מילה. לדיוק מלא — `/sync`.

## פקודות
```bash
npm start                         # בנייה + שרת (טוען .env)
npm run test:kotel -- <קובץ> --seconds 600 --drive http://localhost:3111 --realtime
render deploys create srv-dal3cs2jnfac73cb8c90 --output json --confirm
curl -s https://slichot.onrender.com/api/health | python3 -m json.tool
```
