# -*- coding: utf-8 -*-
"""בונה את data/slichot.json מתוך מקור Sefaria (סליחות נוסח עדות המזרח, תורת אמת - רשות הציבור)."""
import json, re, unicodedata

NIKUD = r'[֑-ׇ]'
SRC = 'data/raw_sefaria.json'
OUT = 'data/slichot.json'

# חלוקה לפרקים: (אינדקס פסקה פותחת, כותרת, slug)
SECTIONS = [
 (1,  'אַשְׁרֵי', 'ashrei', 'אשרי יושבי ביתך'),
 (2,  'חֲצִי קַדִּישׁ', 'chatzi-kaddish', 'חצי קדיש'),
 (3,  'בֶּן אָדָם', 'ben-adam', 'בן אדם מה לך נרדם'),
 (4,  'לְךָ ה׳ הַצְּדָקָה', 'lecha-hashem-hatzedaka', 'לך ה׳ הצדקה ולנו בושת הפנים'),
 (5,  'לְמַעַנְךָ אֱלֹהַי', 'lemaancha-elohai', 'למענך אלהי'),
 (10, 'אֲדֹנָי שְׁמָעָה', 'adonai-shemaa', 'אדני שמעה אדני סלחה'),
 (11, 'שֵׁבֶט יְהוּדָה', 'shevet-yehuda', 'שבט יהודה בדוחק ובצער'),
 (12, 'אֵל מֶלֶךְ יוֹשֵׁב', 'el-melech-1', 'אל מלך יושב על כסא רחמים'),
 (13, 'וַיַּעֲבֹר — י״ג מִדּוֹת', 'vayaavor-1', 'שלוש עשרה מידות של רחמים'),
 (14, 'רַחֲמָנָא', 'rachamana', 'רחמנא אדכר לן'),
 (53, 'וַיַּעֲבֹר', 'vayaavor-2', 'שלוש עשרה מידות'),
 (54, 'אַנְשֵׁי אֱמוּנָה אָבָדוּ', 'anshei-emuna', 'אנשי אמונה אבדו'),
 (55, 'אֵל מֶלֶךְ וַיַּעֲבֹר', 'el-melech-2', 'אל מלך יושב וי״ג מידות'),
 (57, 'תָּמַהְנוּ מֵרָעוֹת', 'tamahnu', 'תמהנו מרעות'),
 (58, 'אֵל מֶלֶךְ וַיַּעֲבֹר', 'el-melech-3', 'אל מלך יושב וי״ג מידות'),
 (61, 'אַל תַּעַשׂ עִמָּנוּ כָּלָה', 'al-taas-kala', 'אלהינו ואלהי אבותינו'),
 (62, 'רִבּוֹנוֹ שֶׁל עוֹלָם — וִדּוּי', 'ribono-shel-olam', 'ריבונו של עולם, וידוי'),
 (65, 'אָשַׁמְנוּ — וִדּוּי', 'ashamnu', 'אשמנו בגדנו, סדר הווידוי'),
 (67, 'לַה׳ אֱלֹהֵינוּ הָרַחֲמִים וְהַסְּלִיחוֹת', 'harachamim-vehaslichot', 'לה׳ אלהינו הרחמים והסליחות'),
 (71, 'שְׁמַע יִשְׂרָאֵל', 'shema-yisrael', 'שמע ישראל ה׳ אלהינו'),
 (73, 'אֶרְאֶלֵּי מַעְלָה', 'erelei-maala', 'אראלי מעלה'),
 (76, 'ה׳ מֶלֶךְ', 'hashem-melech', 'ה׳ מלך ה׳ מלך ה׳ ימלוך'),
 (83, 'מְיֻחָד בְּאֶהְיֶה', 'meyuchad', 'מיוחד באהיה אשר אהיה'),
 (84, 'אֶחָד אֱלֹהֵינוּ', 'echad-eloheinu', 'אחד אלהינו גדול אדוננו'),
 (85, 'לִקְדֻשַּׁת שִׁמְךָ', 'likdushat-shimcha', 'לקדושת שמך עשה'),
 (86, 'אֱלֹהֵינוּ שֶׁבַּשָּׁמַיִם', 'eloheinu-shebashamayim', 'אלהינו שבשמים'),
 (149,'עֲשֵׂה עִמָּנוּ אוֹת לְטוֹבָה', 'ase-imanu-ot', 'עשה עמנו אות לטובה'),
 (150,'בְּרֹגֶז רַחֵם תִּזְכּוֹר', 'berogez-rachem', 'ברוגז רחם תזכור'),
 (151,'עֲנֵנוּ', 'aneinu', 'עננו אלהי אברהם עננו'),
 (153,'רַחוּם וְחַנּוּן', 'rachum-vechanun', 'רחום וחנון חטאנו לפניך'),
 (154,'אֲדוֹן הַסְּלִיחוֹת', 'adon-haslichot', 'אדון הסליחות בוחן לבבות'),
 (155,'אֵל אַדִּיר שְׁמֶךָ', 'el-adir-shimcha', 'אל אדיר שמך'),
 (162,'ה׳ חָנֵּנוּ וַהֲקִימֵנוּ', 'hashem-chaneinu', 'ובספר חיים זכרנו וכתבנו'),
 (169,'ה׳ עֲשֵׂה לְמַעַן שְׁמֶךָ', 'ase-lemaan-shimcha', 'ה׳ עשה למען שמך'),
 (181,'עֲשֵׂה לְמַעַן שְׁמֶךָ', 'ase-lemaan', 'עשה למען שמך עשה למען אמתך'),
 (184,'דְּעָנֵי לַעֲנִיֵּי', 'deanei', 'דעני לעניי ענינן'),
 (185,'יָהּ שְׁמַע אֶבְיוֹנֶיךָ', 'yah-shema', 'יה שמע אביוניך'),
 (193,'אֵל מֶלֶךְ וַיַּעֲבֹר', 'el-melech-4', 'אל מלך יושב וי״ג מידות'),
 (195,'בְּזָכְרִי עַל מִשְׁכָּבִי', 'bezochri', 'בזכרי על משכבי'),
 (196,'לְךָ אֵלִי צוּר חֵילִי', 'lecha-eli', 'לך אלי צור חילי'),
 (197,'עֲנֵנִי ה׳ עֲנֵנִי', 'aneni-hashem', 'ענני ה׳ ענני'),
 (198,'מַה יִּתְאוֹנֵן', 'ma-yitonen', 'מה יתאונן ויאמר'),
 (199,'חֲצוֹת לַיְלָה', 'chatzot-layla', 'חצות לילה לך קמו'),
 (200,'רַחוּם וְחַנּוּן', 'rachum-2', 'רחום וחנון חטאנו לפניך'),
 (201,'לְדָוִד אֵלֶיךָ ה׳ נַפְשִׁי אֶשָּׂא', 'ledavid-elecha', 'תהלים כ״ה'),
 (202,'אֲתָאנוּ לְחַלּוֹת פָּנֶיךָ', 'atanu-lechalot', 'אתאנו לחלות פניך'),
 (204,'מָרַנָא דְּבִשְׁמַיָּא', 'marana', 'מרנא דבשמיא'),
 (207,'אֵלֶיךָ ה׳ נָשָׂאתִי עֵינַי', 'elecha-nasati', 'אליך ה׳ נשאתי עיני'),
 (208,'אָבִינוּ אָב הָרַחֲמָן', 'avinu-av-harachaman', 'והושיענו למען שמך'),
 (219,'חֲמֹל עַל עַמֶּךָ', 'chamol', 'חמול על עמך'),
 (220,'אָבִינוּ מַלְכֵּנוּ', 'avinu-malkeinu', 'אבינו מלכנו'),
 (222,'שׁוֹמֵר יִשְׂרָאֵל', 'shomer-yisrael', 'שומר ישראל'),
 (226,'קַדִּישׁ', 'kaddish-1', 'קדיש'),
 (227,'שִׁיר הַמַּעֲלוֹת מִמַּעֲמַקִּים', 'shir-hamaalot', 'תהלים ק״ל'),
 (228,'קַדִּישׁ יְהֵא שְׁלָמָא', 'kaddish-2', 'קדיש יהא שלמא'),
]

# פסקאות שהוסרו מהסדר לבקשת בעלי האתר
SKIP_PARAGRAPHS = {0, 60}

SHEM = re.compile(r'(?<![א-ת])י' + NIKUD + r'*ה' + NIKUD + r'*ו' + NIKUD + r'*ה' + NIKUD + r'*(?![א-ת])')

def fix_shem(s):
    return SHEM.sub('יְהֹוָה', s)

FINALS = {'ך':'כ','ם':'מ','ן':'נ','ף':'פ','ץ':'צ'}

def norm(w):
    w = re.sub(NIKUD, '', w)
    w = re.sub(r'[^א-ת]', '', w)
    w = ''.join(FINALS.get(c, c) for c in w)
    return w

def main():
    raw = json.load(open(SRC, encoding='utf-8'))['versions'][0]['text']
    paras = []
    for p in raw:
        p = re.sub(r'<br\s*/?>', ' ', p)
        p = re.sub(r'<[^>]+>', '', p)
        p = p.replace('&nbsp;', ' ')
        p = fix_shem(p)
        p = re.sub(r'[ \t]+', ' ', p).strip()
        paras.append(p)

    bounds = [s[0] for s in SECTIONS] + [len(paras)]
    sections, widx = [], 0
    for si, (start, title, slug, desc) in enumerate(SECTIONS):
        end = bounds[si + 1]
        sec = {'id': si, 'slug': slug, 'title': title, 'desc': desc, 'paragraphs': []}
        for pi in range(start, end):
            if pi in SKIP_PARAGRAPHS:
                continue
            text = paras[pi]
            direction = ''
            m = re.match(r'^\((.*?)\)\s*', text)
            if m:
                direction = m.group(1).strip()
                text = text[m.end():]
            tokens = []
            for tok in text.split(' '):
                if not tok:
                    continue
                n = norm(tok)
                inline_note = tok.startswith('(') or tok.endswith(')')
                tokens.append({'t': tok, 'n': n, 'i': widx, 'skip': (not n) or inline_note})
                widx += 1
            sec['paragraphs'].append({'p': pi, 'dir': direction, 'w': tokens})
        if sec['paragraphs']:
            sections.append(sec)

    flat = [t for s in sections for p in s['paragraphs'] for t in p['w']]
    doc = {
        'title': 'סליחות נוסח עדות המזרח',
        'source': 'ספריא — סליחות נוסח עדות המזרח (תורת אמת), נחלת הכלל',
        'sourceUrl': 'https://www.sefaria.org.il/Selichot_Edot_HaMizrach',
        'wordCount': len(flat),
        'sections': sections,
    }
    json.dump(doc, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    # אינדקס חיפוש למנוע הסנכרון: רשימת מילים מנורמלות בלבד
    json.dump([t['n'] for t in flat], open('data/index_words.json', 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    print('sections:', len(sections), 'paragraphs:', len(paras), 'words:', len(flat))

main()
