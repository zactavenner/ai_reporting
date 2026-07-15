// Map North American Numbering Plan (NANP) area codes to an IANA timezone.
// Coverage: US + Canada + major Caribbean. Best-effort — a few area codes
// straddle two zones; we pick the dominant one.

const AREA_CODE_TZ: Record<string, string> = {
  // Eastern
  "201":"America/New_York","202":"America/New_York","203":"America/New_York","207":"America/New_York",
  "212":"America/New_York","215":"America/New_York","216":"America/New_York","217":"America/Chicago",
  "223":"America/New_York","224":"America/Chicago","225":"America/Chicago","227":"America/New_York",
  "228":"America/Chicago","229":"America/New_York","231":"America/New_York","234":"America/New_York",
  "239":"America/New_York","240":"America/New_York","243":"America/Toronto","248":"America/New_York",
  "251":"America/Chicago","252":"America/New_York","253":"America/Los_Angeles","254":"America/Chicago",
  "256":"America/Chicago","260":"America/Indiana/Indianapolis","262":"America/Chicago","267":"America/New_York",
  "269":"America/Detroit","270":"America/Chicago","272":"America/New_York","276":"America/New_York",
  "279":"America/Los_Angeles","281":"America/Chicago","283":"America/New_York","301":"America/New_York",
  "302":"America/New_York","303":"America/Denver","304":"America/New_York","305":"America/New_York",
  "307":"America/Denver","308":"America/Chicago","309":"America/Chicago","310":"America/Los_Angeles",
  "312":"America/Chicago","313":"America/Detroit","314":"America/Chicago","315":"America/New_York",
  "316":"America/Chicago","317":"America/Indiana/Indianapolis","318":"America/Chicago","319":"America/Chicago",
  "320":"America/Chicago","321":"America/New_York","323":"America/Los_Angeles","325":"America/Chicago",
  "327":"America/Chicago","330":"America/New_York","331":"America/Chicago","332":"America/New_York",
  "334":"America/Chicago","336":"America/New_York","337":"America/Chicago","339":"America/New_York",
  "341":"America/Los_Angeles","346":"America/Chicago","347":"America/New_York","351":"America/New_York",
  "352":"America/New_York","360":"America/Los_Angeles","361":"America/Chicago","364":"America/Chicago",
  "369":"America/Los_Angeles","380":"America/New_York","385":"America/Denver","386":"America/New_York",
  "401":"America/New_York","402":"America/Chicago","404":"America/New_York","405":"America/Chicago",
  "406":"America/Denver","407":"America/New_York","408":"America/Los_Angeles","409":"America/Chicago",
  "410":"America/New_York","412":"America/New_York","413":"America/New_York","414":"America/Chicago",
  "415":"America/Los_Angeles","417":"America/Chicago","419":"America/New_York","423":"America/New_York",
  "424":"America/Los_Angeles","425":"America/Los_Angeles","430":"America/Chicago","432":"America/Chicago",
  "434":"America/New_York","435":"America/Denver","440":"America/New_York","442":"America/Los_Angeles",
  "443":"America/New_York","445":"America/New_York","447":"America/Chicago","458":"America/Los_Angeles",
  "463":"America/Indiana/Indianapolis","464":"America/Chicago","469":"America/Chicago","470":"America/New_York",
  "475":"America/New_York","478":"America/New_York","479":"America/Chicago","480":"America/Phoenix",
  "484":"America/New_York","501":"America/Chicago","502":"America/New_York","503":"America/Los_Angeles",
  "504":"America/Chicago","505":"America/Denver","507":"America/Chicago","508":"America/New_York",
  "509":"America/Los_Angeles","510":"America/Los_Angeles","512":"America/Chicago","513":"America/New_York",
  "515":"America/Chicago","516":"America/New_York","517":"America/Detroit","518":"America/New_York",
  "520":"America/Phoenix","530":"America/Los_Angeles","531":"America/Chicago","534":"America/Chicago",
  "539":"America/Chicago","540":"America/New_York","541":"America/Los_Angeles","551":"America/New_York",
  "557":"America/Chicago","559":"America/Los_Angeles","561":"America/New_York","562":"America/Los_Angeles",
  "563":"America/Chicago","564":"America/Los_Angeles","567":"America/New_York","570":"America/New_York",
  "571":"America/New_York","573":"America/Chicago","574":"America/Indiana/Indianapolis","575":"America/Denver",
  "580":"America/Chicago","585":"America/New_York","586":"America/Detroit","601":"America/Chicago",
  "602":"America/Phoenix","603":"America/New_York","605":"America/Chicago","606":"America/New_York",
  "607":"America/New_York","608":"America/Chicago","609":"America/New_York","610":"America/New_York",
  "612":"America/Chicago","614":"America/New_York","615":"America/Chicago","616":"America/Detroit",
  "617":"America/New_York","618":"America/Chicago","619":"America/Los_Angeles","620":"America/Chicago",
  "623":"America/Phoenix","626":"America/Los_Angeles","628":"America/Los_Angeles","629":"America/Chicago",
  "630":"America/Chicago","631":"America/New_York","636":"America/Chicago","640":"America/New_York",
  "641":"America/Chicago","646":"America/New_York","650":"America/Los_Angeles","651":"America/Chicago",
  "657":"America/Los_Angeles","659":"America/Chicago","660":"America/Chicago","661":"America/Los_Angeles",
  "662":"America/Chicago","667":"America/New_York","669":"America/Los_Angeles","671":"Pacific/Guam",
  "678":"America/New_York","680":"America/New_York","681":"America/New_York","682":"America/Chicago",
  "689":"America/New_York","701":"America/Chicago","702":"America/Los_Angeles","703":"America/New_York",
  "704":"America/New_York","706":"America/New_York","707":"America/Los_Angeles","708":"America/Chicago",
  "712":"America/Chicago","713":"America/Chicago","714":"America/Los_Angeles","715":"America/Chicago",
  "716":"America/New_York","717":"America/New_York","718":"America/New_York","719":"America/Denver",
  "720":"America/Denver","724":"America/New_York","725":"America/Los_Angeles","726":"America/Chicago",
  "727":"America/New_York","730":"America/Chicago","731":"America/Chicago","732":"America/New_York",
  "734":"America/Detroit","737":"America/Chicago","740":"America/New_York","743":"America/New_York",
  "747":"America/Los_Angeles","754":"America/New_York","757":"America/New_York","760":"America/Los_Angeles",
  "762":"America/New_York","763":"America/Chicago","765":"America/Indiana/Indianapolis","769":"America/Chicago",
  "770":"America/New_York","772":"America/New_York","773":"America/Chicago","774":"America/New_York",
  "775":"America/Los_Angeles","779":"America/Chicago","781":"America/New_York","785":"America/Chicago",
  "786":"America/New_York","787":"America/Puerto_Rico","801":"America/Denver","802":"America/New_York",
  "803":"America/New_York","804":"America/New_York","805":"America/Los_Angeles","806":"America/Chicago",
  "808":"Pacific/Honolulu","810":"America/Detroit","812":"America/Indiana/Indianapolis","813":"America/New_York",
  "814":"America/New_York","815":"America/Chicago","816":"America/Chicago","817":"America/Chicago",
  "818":"America/Los_Angeles","820":"America/Los_Angeles","828":"America/New_York","830":"America/Chicago",
  "831":"America/Los_Angeles","832":"America/Chicago","835":"America/New_York","838":"America/New_York",
  "839":"America/New_York","840":"America/Los_Angeles","843":"America/New_York","845":"America/New_York",
  "847":"America/Chicago","848":"America/New_York","850":"America/Chicago","854":"America/New_York",
  "856":"America/New_York","857":"America/New_York","858":"America/Los_Angeles","859":"America/New_York",
  "860":"America/New_York","861":"America/Chicago","862":"America/New_York","863":"America/New_York",
  "864":"America/New_York","865":"America/New_York","870":"America/Chicago","872":"America/Chicago",
  "878":"America/New_York","901":"America/Chicago","903":"America/Chicago","904":"America/New_York",
  "906":"America/Detroit","907":"America/Anchorage","908":"America/New_York","909":"America/Los_Angeles",
  "910":"America/New_York","912":"America/New_York","913":"America/Chicago","914":"America/New_York",
  "915":"America/Denver","916":"America/Los_Angeles","917":"America/New_York","918":"America/Chicago",
  "919":"America/New_York","920":"America/Chicago","925":"America/Los_Angeles","928":"America/Phoenix",
  "929":"America/New_York","930":"America/Indiana/Indianapolis","931":"America/Chicago","934":"America/New_York",
  "936":"America/Chicago","937":"America/New_York","938":"America/Chicago","940":"America/Chicago",
  "941":"America/New_York","943":"America/New_York","945":"America/Chicago","947":"America/Detroit",
  "948":"America/New_York","949":"America/Los_Angeles","951":"America/Los_Angeles","952":"America/Chicago",
  "954":"America/New_York","956":"America/Chicago","959":"America/New_York","970":"America/Denver",
  "971":"America/Los_Angeles","972":"America/Chicago","973":"America/New_York","975":"America/Chicago",
  "978":"America/New_York","979":"America/Chicago","980":"America/New_York","984":"America/New_York",
  "985":"America/Chicago","986":"America/Boise","989":"America/Detroit",
  // Canada (major)
  "204":"America/Winnipeg","226":"America/Toronto","236":"America/Vancouver","249":"America/Toronto",
  "250":"America/Vancouver","257":"America/Toronto","263":"America/Montreal","289":"America/Toronto",
  "306":"America/Regina","343":"America/Toronto","354":"America/Toronto","365":"America/Toronto",
  "367":"America/Montreal","368":"America/Edmonton","382":"America/Toronto","387":"America/Montreal",
  "403":"America/Edmonton","416":"America/Toronto","418":"America/Montreal","428":"America/Moncton",
  "431":"America/Winnipeg","437":"America/Toronto","438":"America/Montreal","450":"America/Montreal",
  "468":"America/Montreal","474":"America/Regina","506":"America/Moncton","514":"America/Montreal",
  "519":"America/Toronto","548":"America/Toronto","579":"America/Montreal","581":"America/Montreal",
  "584":"America/Winnipeg","587":"America/Edmonton","604":"America/Vancouver","613":"America/Toronto",
  "639":"America/Regina","647":"America/Toronto","672":"America/Vancouver","683":"America/Toronto",
  "705":"America/Toronto","709":"America/St_Johns","742":"America/Toronto","753":"America/Toronto",
  "778":"America/Vancouver","780":"America/Edmonton","782":"America/Halifax","807":"America/Toronto",
  "819":"America/Montreal","825":"America/Edmonton","867":"America/Yellowknife","873":"America/Montreal",
  "902":"America/Halifax","905":"America/Toronto",
};

const TZ_ABBREV: Record<string, string> = {
  "America/New_York":"ET","America/Detroit":"ET","America/Indiana/Indianapolis":"ET",
  "America/Toronto":"ET","America/Montreal":"ET",
  "America/Chicago":"CT","America/Winnipeg":"CT","America/Regina":"CT",
  "America/Denver":"MT","America/Boise":"MT","America/Edmonton":"MT",
  "America/Phoenix":"MST",
  "America/Los_Angeles":"PT","America/Vancouver":"PT",
  "America/Anchorage":"AKT","Pacific/Honolulu":"HST","Pacific/Guam":"ChST",
  "America/Puerto_Rico":"AST","America/Halifax":"AT","America/Moncton":"AT","America/St_Johns":"NT",
  "America/Yellowknife":"MT",
};

export function extractAreaCode(phone?: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D+/g, "");
  if (!digits) return null;
  // Trim leading country code "1" for NANP
  const nanp = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (nanp.length < 3) return null;
  return nanp.slice(0, 3);
}

export interface PhoneTimezone {
  areaCode: string;
  tz: string;
  abbrev: string;
  localTime: string; // HH:mm
  offsetLabel: string; // e.g. "GMT-5"
}

export function getPhoneTimezone(phone?: string | null, now: Date = new Date()): PhoneTimezone | null {
  const ac = extractAreaCode(phone);
  if (!ac) return null;
  const tz = AREA_CODE_TZ[ac];
  if (!tz) return null;
  try {
    const localTime = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true,
    }).format(now);
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, timeZoneName: "shortOffset",
    }).formatToParts(now);
    const off = parts.find(p => p.type === "timeZoneName")?.value || "";
    return {
      areaCode: ac,
      tz,
      abbrev: TZ_ABBREV[tz] || tz.split("/").pop() || tz,
      localTime,
      offsetLabel: off,
    };
  } catch {
    return { areaCode: ac, tz, abbrev: TZ_ABBREV[tz] || tz, localTime: "", offsetLabel: "" };
  }
}

// Is the local time at that phone's area code within business hours (default 8am-8pm)?
export function isBusinessHours(phone?: string | null, now: Date = new Date(), start = 8, end = 20): boolean | null {
  const tzInfo = getPhoneTimezone(phone, now);
  if (!tzInfo) return null;
  try {
    const hourStr = new Intl.DateTimeFormat("en-US", {
      timeZone: tzInfo.tz, hour: "numeric", hour12: false,
    }).format(now);
    const h = parseInt(hourStr, 10);
    if (Number.isNaN(h)) return null;
    return h >= start && h < end;
  } catch { return null; }
}