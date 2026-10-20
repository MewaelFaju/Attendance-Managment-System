/* Language (English / Amharic) and Ethiopian calendar + clock helpers. Loaded before script.js. */
(() => {
  'use strict';

  const LANG_KEY = 'attendance.lang';
  const TZ = 'Africa/Addis_Ababa';

  let lang = 'en';
  try {
    lang = localStorage.getItem(LANG_KEY) === 'am' ? 'am' : 'en';
  } catch {
    // storage unavailable: English
  }

  /* ---------------- dictionary (English text -> Amharic) ---------------- */

  const AM = {
    // titles & login
    'Med Tech Com Trading Employees Attendance System': 'መድ ቴክ ኮም ትሬዲንግ የሠራተኞች የመገኘት ሥርዓት',
    'WORKFORCE MANAGER': 'የሠራተኞች አስተዳደር',
    Username: 'የተጠቃሚ ስም',
    Password: 'የይለፍ ቃል',
    'Sign In': 'ግባ',
    'Enter username': 'የተጠቃሚ ስም ያስገቡ',
    'Enter password': 'የይለፍ ቃል ያስገቡ',
    // top bar
    'Welcome back': 'እንኳን ደህና መጡ',
    Employee: 'ሠራተኛ',
    'Dark mode': 'ጨለማ ገጽታ',
    'Light mode': 'ብሩህ ገጽታ',
    'Phone access': 'የስልክ መዳረሻ',
    'Change password': 'የይለፍ ቃል ቀይር',
    Logout: 'ውጣ',
    // hero
    Today: 'ዛሬ',
    'Loading...': 'በመጫን ላይ...',
    'Not checked in': 'አልገባም',
    'Checked in': 'ገብቷል',
    'Checked in (late)': 'ገብቷል (ዘግይቷል)',
    'Checked out': 'ወጥቷል',
    'Check In': 'መግቢያ',
    'Check Out': 'መውጫ',
    'Check in': 'መግቢያ',
    'Check out': 'መውጫ',
    // mark attendance
    'Mark Attendance': 'መገኘት መዝግብ',
    'Filter Report': 'ሪፖርት አጣራ',
    'All Records': 'ሁሉም መዝገቦች',
    Present: 'ተገኝቷል',
    present: 'ተገኝቷል',
    Permission: 'ፈቃድ',
    permission: 'ፈቃድ',
    FieldWork: 'የመስክ ሥራ',
    fieldwork: 'የመስክ ሥራ',
    'Mark FieldWork': 'የመስክ ሥራ ምልክት አድርግ',
    'Clear FieldWork': 'የመስክ ሥራ ምልክት አስወግድ',
    'Mark Permission': 'ፈቃድ ምልክት አድርግ',
    'Clear Permission': 'ፈቃድ ምልክት አስወግድ',
    Late: 'ዘግይቷል',
    late: 'ዘግይቷል',
    'Absent (today)': 'ያልመጣ (ዛሬ)',
    // stats
    'Total Employees': 'ጠቅላላ ሠራተኞች',
    'Present Today': 'ዛሬ የተገኙ',
    'Late Arrivals Today': 'ዛሬ የዘገዩ',
    'Permission Today': 'ዛሬ ፈቃድ ላይ ያሉ',
    'FieldWork Today': 'ዛሬ በመስክ ሥራ ላይ ያሉ',
    'Not In Yet': 'ገና ያልገቡ',
    "Today's attendance": 'የዛሬ መገኘት',
    'Last 7 days': 'ያለፉት 7 ቀናት',
    'People who checked in, by day': 'በቀን የገቡ ሰዎች',
    'View as table': 'እንደ ሰንጠረዥ እይ',
    'View as chart': 'እንደ ገበታ እይ',
    Date: 'ቀን',
    'On time': 'በሰዓቱ',
    'On Time': 'በሰዓቱ',
    Total: 'ድምር',
    'Not in yet': 'ገና አልገባም',
    // team
    'Team right now': 'አሁን ያለው ቡድን',
    "Who is in, who has left, who hasn't arrived": 'ማን እንዳለ፣ ማን እንደወጣ፣ ማን እንዳልደረሰ',
    // employees
    Employees: 'ሠራተኞች',
    '+ Add Employee': '+ ሠራተኛ ጨምር',
    'Add Employee': 'ሠራተኛ ጨምር',
    'Employee Name': 'የሠራተኛ ስም',
    'Enter full name': 'ሙሉ ስም ያስገቡ',
    Email: 'ኢሜይል',
    Role: 'ሚና',
    'e.g. Developer': 'ለምሳሌ ገንቢ',
    'ID Card': 'የመታወቂያ ቁጥር',
    'Employee ID': 'የሠራተኛ መታወቂያ',
    'Login Password': 'የመግቢያ የይለፍ ቃል',
    '(optional, min 8)': '(አማራጭ፣ ቢያንስ 8)',
    'Lets the employee sign in with their email': 'ሠራተኛው በኢሜይሉ እንዲገባ ያስችላል',
    'Leave blank to keep current password': 'የአሁኑን ለማቆየት ባዶ ይተዉ',
    'Employee Photo': 'የሠራተኛ ፎቶ',
    'Save Changes': 'ለውጦችን አስቀምጥ',
    Cancel: 'አቋርጥ',
    Photo: 'ፎቶ',
    Name: 'ስም',
    Action: 'እርምጃ',
    Actions: 'እርምጃዎች',
    Edit: 'አርም',
    Delete: 'ሰርዝ',
    // records
    'Attendance Records': 'የመገኘት መዝገቦች',
    'All Employees': 'ሁሉም ሠራተኞች',
    'All time': 'ሁሉም ጊዜ',
    'This month': 'ይህ ወር',
    'Last month': 'ባለፈው ወር',
    'Custom range': 'የተመረጠ ክልል',
    'Download CSV': 'CSV አውርድ',
    'Reset Data': 'ዳታ አጽዳ',
    Hours: 'ሰዓታት',
    Status: 'ሁኔታ',
    'Filter by employee': 'በሠራተኛ አጣራ',
    'Date range': 'የቀን ክልል',
    'From date': 'ከቀን',
    'To date': 'እስከ ቀን',
    Month: 'ወር',
    // report & monthly
    'Attendance Report': 'የመገኘት ሪፖርት',
    'Total Records': 'ጠቅላላ መዝገቦች',
    'Avg. Hours': 'አማካይ ሰዓት',
    'Monthly summary': 'ወርሃዊ ማጠቃለያ',
    'Days worked and hours per employee': 'የሥራ ቀናት እና ሰዓታት በሠራተኛ',
    'Days worked': 'የሠሩባቸው ቀናት',
    'Absent days': 'የቀሩባቸው ቀናት',
    'Total hours': 'ጠቅላላ ሰዓታት',
    'Avg. hours / day': 'አማካይ ሰዓት / ቀን',
    'Weekly (last 7 days)': 'ሳምንታዊ (ያለፉት 7 ቀናት)',
    'Monthly (this month)': 'ወርሃዊ (ይህ ወር)',
    'Monthly (last month)': 'ወርሃዊ (ባለፈው ወር)',
    'Report period': 'የሪፖርት ወቅት',
    'File format': 'የፋይል ዓይነት',
    'Excel (.xlsx)': 'ኤክሴል (.xlsx)',
    'Word (.docx)': 'ዎርድ (.docx)',
    'PDF (.pdf)': 'ፒዲኤፍ (.pdf)',
    'Download Report': 'ሪፖርት አውርድ',
    // dialogs
    'Current password': 'የአሁኑ የይለፍ ቃል',
    'New password': 'አዲስ የይለፍ ቃል',
    '(min 8 characters)': '(ቢያንስ 8 ቁምፊ)',
    'Confirm new password': 'አዲሱን የይለፍ ቃል ያረጋግጡ',
    'Update password': 'የይለፍ ቃል አዘምን',
    'Edit attendance': 'መገኘት አርም',
    '(leave empty if still in)': '(ገና ካልወጣ ባዶ ይተዉ)',
    '(Gregorian date, 24-hour clock)': '(የግሪጎሪያን ቀን፣ 24 ሰዓት)',
    'Save changes': 'ለውጦችን አስቀምጥ',
    // dynamic messages
    'Select an employee first': 'መጀመሪያ ሠራተኛ ይምረጡ',
    'No attendance records for this filter.': 'ለዚህ ማጣሪያ የመገኘት መዝገብ የለም።',
    'No attendance report data.': 'የሪፖርት ዳታ የለም።',
    'No employees yet. Add your first one.': 'ገና ሠራተኛ የለም። የመጀመሪያውን ይጨምሩ።',
    'No employees yet': 'ገና ሠራተኛ የለም',
    'No employees yet.': 'ገና ሠራተኛ የለም።',
    'Nobody has checked in yet': 'እስካሁን ማንም አልገባም',
    'First in': 'መጀመሪያ የገባ',
    'Average arrival': 'አማካይ የመግቢያ ሰዓት',
    'Still in the office': 'አሁንም በቢሮ ያሉ',
    'Left at': 'የወጣው በ',
    'In since': 'የገባው በ',
    'Day off · no attendance expected': 'የዕረፍት ቀን · መገኘት አይጠበቅም',
    'No check-ins in the last 7 days': 'በያለፉት 7 ቀናት ማንም አልገባም',
    'Work hours': 'የሥራ ሰዓት',
    'day off today': 'ዛሬ የዕረፍት ቀን',
    'no work days': 'የሥራ ቀን የለም',
    'Ethiopian time': 'የኢትዮጵያ ሰዓት',
    'Sat until': 'ቅዳሜ እስከ',
    'Gregorian': 'ግሪጎሪያን',
    'Record updated': 'መዝገቡ ተዘምኗል',
    'Record deleted': 'መዝገቡ ተሰርዟል',
    'Password updated': 'የይለፍ ቃል ተዘምኗል',
    'The new passwords do not match': 'አዲሶቹ የይለፍ ቃላት አይመሳሰሉም',
    'Employee updated': 'ሠራተኛው ተዘምኗል',
    'Employee added': 'ሠራተኛ ተጨምሯል',
    'Employee deleted': 'ሠራተኛው ተሰርዟል',
    early: 'ቀደም ብሎ',
    'Left before the end of the work day': 'የሥራ ቀን ሳያልቅ ወጥቷል',
    'Session expired. Please sign in again.': 'ክፍለ ጊዜው አብቅቷል። እባክዎ እንደገና ይግቡ።',
    'Cannot reach the server. Is it running? (npm start)': 'አገልጋዩን ማግኘት አልተቻለም።',
  };

  const EN_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const AM_DAYS = ['እሑድ', 'ሰኞ', 'ማክሰኞ', 'ረቡዕ', 'ሐሙስ', 'ዓርብ', 'ቅዳሜ'];
  const AM_DAYS_SHORT = ['እሑድ', 'ሰኞ', 'ማክሰ', 'ረቡዕ', 'ሐሙስ', 'ዓርብ', 'ቅዳሜ'];
  const EN_MONTHS_G = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const AM_MONTHS_G = ['ጃንዩወሪ', 'ፌብሩወሪ', 'ማርች', 'ኤፕሪል', 'ሜይ', 'ጁን', 'ጁላይ', 'ኦገስት', 'ሴፕቴምበር', 'ኦክቶበር', 'ኖቬምበር', 'ዲሴምበር'];
  const EN_MONTHS_E = ['Meskerem', 'Tikimt', 'Hidar', 'Tahsas', 'Tir', 'Yekatit', 'Megabit', 'Miazia', 'Ginbot', 'Sene', 'Hamle', 'Nehase', 'Pagume'];
  const AM_MONTHS_E = ['መስከረም', 'ጥቅምት', 'ኅዳር', 'ታኅሣሥ', 'ጥር', 'የካቲት', 'መጋቢት', 'ሚያዝያ', 'ግንቦት', 'ሰኔ', 'ሐምሌ', 'ነሐሴ', 'ጳጉሜ'];

  const isAm = () => lang === 'am';
  const t = (en) => (isAm() && AM[en] !== undefined ? AM[en] : en);

  /* ---------------- Ethiopian calendar & clock ---------------- */

  const addisFormat = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  });

  // Wall-clock parts of an instant in Addis Ababa (the zone the server schedule runs in).
  function addis(date) {
    const p = {};
    for (const { type, value } of addisFormat.formatToParts(date)) p[type] = Number(value);
    const weekday = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
    return { y: p.year, m: p.month, d: p.day, h: p.hour % 24, mi: p.minute, s: p.second, wd: weekday };
  }

  function gregorianToEthiopian(y, m, d) {
    const a = Math.floor((14 - m) / 12);
    const yy = y + 4800 - a;
    const mm = m + 12 * a - 3;
    const jdn =
      d + Math.floor((153 * mm + 2) / 5) + 365 * yy + Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400) - 32045;
    const r = (jdn - 1723856) % 1461;
    const n = (r % 365) + 365 * Math.floor(r / 1460);
    return {
      y: 4 * Math.floor((jdn - 1723856) / 1461) + Math.floor(r / 365) - Math.floor(r / 1460),
      m: Math.floor(n / 30) + 1,
      d: (n % 30) + 1,
    };
  }

  // Ethiopian clock: the day starts at 6:00 (our 12:00), so hours are shifted by six. AM = daytime half.
  function ethClock(h, mi, s) {
    const hour = (h + 6) % 12 || 12;
    const day = h >= 6 && h < 18;
    const mm = String(mi).padStart(2, '0');
    const time = s == null ? `${hour}:${mm}` : `${hour}:${mm}:${String(s).padStart(2, '0')}`;
    let period;
    if (isAm()) {
      if (day) period = hour === 12 || hour < 6 ? 'ጠዋት' : 'ከሰዓት';
      else period = hour === 12 || hour < 6 ? 'ማታ' : 'ሌሊት';
    } else {
      period = day ? 'AM' : 'PM';
    }
    return `${time} ${period}`;
  }

  const ethDateText = (e, wd, withYear = true) => {
    const month = (isAm() ? AM_MONTHS_E : EN_MONTHS_E)[e.m - 1];
    const day = wd == null ? '' : `${(isAm() ? AM_DAYS : EN_DAYS)[wd]}${isAm() ? '፣ ' : ', '}`;
    return `${day}${month} ${e.d}${withYear ? `${isAm() ? ' ' : ', '}${e.y}` : ''}`;
  };

  const gregDateText = (y, m, d, wd) => {
    const month = isAm() ? AM_MONTHS_G[m - 1] : EN_MONTHS_G[m - 1];
    const day = wd == null ? '' : `${(isAm() ? AM_DAYS_SHORT : EN_DAYS.map((x) => x.slice(0, 3)))[wd]}${isAm() ? '፣ ' : ', '}`;
    return `${day}${month} ${d}, ${y}`;
  };

  // "YYYY-MM-DD" (a server calendar date) -> {eth, greg}
  function dateParts(ymd) {
    const [y, m, d] = ymd.split('-').map(Number);
    const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    return { eth: ethDateText(gregorianToEthiopian(y, m, d), null), greg: gregDateText(y, m, d), wd, y, m, d };
  }

  // ISO instant -> {eth, greg} date + time, in Addis Ababa.
  function instantParts(iso) {
    const a = addis(new Date(iso));
    const e = gregorianToEthiopian(a.y, a.m, a.d);
    return {
      eth: `${ethDateText(e, null)}, ${ethClock(a.h, a.mi)}`,
      greg: `${gregDateText(a.y, a.m, a.d)}, ${String(a.h).padStart(2, '0')}:${String(a.mi).padStart(2, '0')}`,
    };
  }

  const timeOnly = (iso) => {
    const a = addis(new Date(iso));
    return ethClock(a.h, a.mi);
  };

  // "HH:MM" schedule setting -> Ethiopian clock text.
  const scheduleTime = (hhmm) => {
    const [h, mi] = hhmm.split(':').map(Number);
    return ethClock(h, mi);
  };

  /* ---------------- applying the language to the page ---------------- */

  const ATTRS = ['placeholder', 'aria-label', 'title'];

  function translateNode(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.parentNode.closest('script, style')) continue;
      const key = node.__en ?? node.nodeValue.trim();
      if (AM[key] === undefined) continue;
      node.__en = key;
      node.nodeValue = isAm() ? AM[key] : key;
    }
    for (const el of root.querySelectorAll('[placeholder], [aria-label], [title]')) {
      for (const attr of ATTRS) {
        if (!el.hasAttribute(attr)) continue;
        el.__en ??= {};
        const key = el.__en[attr] ?? el.getAttribute(attr);
        if (AM[key] === undefined) continue;
        el.__en[attr] = key;
        el.setAttribute(attr, isAm() ? AM[key] : key);
      }
    }
  }

  function apply() {
    document.documentElement.lang = isAm() ? 'am' : 'en';
    document.title = t('Med Tech Com Trading Employees Attendance System');
    translateNode(document.body);
    for (const button of document.querySelectorAll('.lang-btn')) button.textContent = isAm() ? 'English' : 'አማርኛ';
  }

  function setLang(next) {
    lang = next === 'am' ? 'am' : 'en';
    try {
      localStorage.setItem(LANG_KEY, lang);
    } catch {
      // choice just won't persist
    }
    apply();
    window.dispatchEvent(new CustomEvent('langchange'));
  }

  window.I18N = {
    t,
    isAm,
    apply,
    setLang,
    addis,
    gregorianToEthiopian,
    ethClock,
    ethDateText,
    gregDateText,
    dateParts,
    instantParts,
    timeOnly,
    scheduleTime,
    dayName: (wd, short = false) => (isAm() ? (short ? AM_DAYS_SHORT : AM_DAYS)[wd] : short ? EN_DAYS[wd].slice(0, 3) : EN_DAYS[wd]),
  };
})();
