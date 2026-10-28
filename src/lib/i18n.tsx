import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

const dict = {
  en: {
    tagline: "Private conversations, beautifully simple.",
    getStarted: "Get started",
    signIn: "Sign in",
    signUp: "Create account",
    email: "Email",
    username: "Username",
    password: "Password",
    forgot: "Forgot password?",
    sendReset: "Send reset link",
    chats: "Chats",
    searchChats: "Search chats",
    newChat: "New chat",
    newGroup: "New group",
    startByUsername: "Enter the exact username",
    typeMessage: "Type a message",
    pickChat: "Select a chat to start messaging",
    signOut: "Sign out",
    security: "Security",
    myProfile: "My profile",
    displayName: "Display name",
    changePhoto: "Tap to change photo",
    save: "Save",
    profileSaved: "Profile updated",
    profileSaveFailed: "Could not save profile",
    photoTooBig: "Photo must be under 5 MB",
    photoMustBeImage: "Please choose an image file",
    photo: "Photo",
    video: "Video",
    voiceMessage: "Voice message",
    attachMedia: "Attach media",
    micPermissionTitle: "Microphone Access",
    micPermissionDesc:
      "Voice notes need access to your microphone. Your browser will ask for permission. Audio is only recorded while you hold or tap record.",
    micAllow: "Allow",
    micAllowOnce: "Allow this time",
    micNever: "Never",
    micTurnedOff: "Microphone is turned off",
    micTurnOn: "Turn on",
    micDeniedHint:
      "Microphone access was denied. Please allow microphone in your browser settings (lock icon next to the address bar) and reload.",
    micNotFound: "No microphone was found on this device.",
    micBusy: "Microphone is busy or in use by another application.",
    micInsecure: "Microphone recording requires a secure connection (HTTPS or localhost).",
    appName: "Techu Brothers",
    about: "About",
    defaultAbout: "Hey there! I am using Techu Brothers.",
    searchByUsername: "Search by username...",
    searchByExactUsername: "Search by exact username",
    userNotFound: "User not found",
    cannotChatSelf: "You cannot chat with yourself",
    usernameAvailable: "Username is available",
    usernameTaken: "Username is already taken",
    usernameChecking: "Checking...",
    startChat: "Start Chat",
    savedName: "Contact name",
    saveContact: "Save contact",
    editContact: "Edit contact",
    contactSaved: "Contact saved",
    contactDeleted: "Contact removed",
    removeContact: "Remove contact",
  },
  ur: {
    tagline: "نجی گفتگو، نہایت آسان۔",
    getStarted: "شروع کریں",
    signIn: "سائن ان",
    signUp: "اکاؤنٹ بنائیں",
    email: "ای میل",
    username: "یوزر نیم",
    password: "پاس ورڈ",
    forgot: "پاس ورڈ بھول گئے؟",
    sendReset: "ری سیٹ لنک بھیجیں",
    chats: "چیٹس",
    searchChats: "چیٹس تلاش کریں",
    newChat: "نئی چیٹ",
    newGroup: "نیا گروپ",
    startByUsername: "مکمل یوزر نیم درج کریں",
    typeMessage: "پیغام لکھیں",
    pickChat: "پیغام بھیجنے کے لیے چیٹ منتخب کریں",
    signOut: "سائن آؤٹ",
    security: "سیکیورٹی",
    myProfile: "میرا پروفائل",
    displayName: "ظاہری نام",
    changePhoto: "تصویر بدلنے کے لیے ٹیپ کریں",
    save: "محفوظ کریں",
    profileSaved: "پروفائل اپ ڈیٹ ہو گیا",
    profileSaveFailed: "پروفائل محفوظ نہیں ہو سکا",
    photoTooBig: "تصویر 5 ایم بی سے کم ہونی چاہیے",
    photoMustBeImage: "براہ کرم تصویر والی فائل منتخب کریں",
    photo: "تصویر",
    video: "ویڈیو",
    voiceMessage: "وائس میسج",
    attachMedia: "میڈیا منسلک کریں",
    micPermissionTitle: "مائیکروفون رسائی",
    micPermissionDesc:
      "وائس نوٹس کے لیے آپ کے مائیکروفون تک رسائی درکار ہے۔ آپ کا براؤزر اجازت طلب کرے گا۔ آڈیو صرف اس وقت ریکارڈ ہوتی ہے جب آپ ریکارڈ دباتے یا ٹیپ کرتے ہیں۔",
    micAllow: "اجازت دیں",
    micAllowOnce: "صرف اس بار اجازت دیں",
    micNever: "کبھی نہیں",
    micTurnedOff: "مائیکروفون بند ہے",
    micTurnOn: "آن کریں",
    micDeniedHint:
      "مائیکروفون کی اجازت مسترد کر دی گئی۔ براہ کرم براؤزر سیٹنگز (ایڈریس بار کے ساتھ لاک آئیکن) میں مائیکروفون کی اجازت دیں اور صفحہ ری لوڈ کریں۔",
    micNotFound: "اس ڈیوائس پر کوئی مائیکروفون نہیں ملا۔",
    micBusy: "مائیکروفون فی الحال کسی دوسری ایپلی کیشن کے زیر استعمال ہے۔",
    micInsecure: "مائیکروفون ریکارڈنگ کے لیے محفوظ کنکشن (HTTPS) درکار ہے۔",
    appName: "ٹیچو برادرز",
    about: "معلومات",
    defaultAbout: "سلام! میں ٹیچو برادرز استعمال کر رہا ہوں۔",
    searchByUsername: "یوزر نیم سے تلاش کریں...",
    searchByExactUsername: "مکمل یوزر نیم سے تلاش کریں",
    userNotFound: "صارف نہیں ملا",
    cannotChatSelf: "آپ اپنے آپ سے چیٹ نہیں کر سکتے",
    usernameAvailable: "یوزر نیم دستیاب ہے",
    usernameTaken: "یہ یوزر نیم پہلے سے موجود ہے",
    usernameChecking: "جانچ ہو رہی ہے...",
    startChat: "چیٹ شروع کریں",
    savedName: "رابطے کا نام",
    saveContact: "رابطہ محفوظ کریں",
    editContact: "رابطے کا نام تبدیل کریں",
    contactSaved: "رابطہ محفوظ ہو گیا",
    contactDeleted: "رابطہ حذف ہو گیا",
    removeContact: "رابطہ حذف کریں",
  },
} as const;

type Lang = keyof typeof dict;
type Key = keyof (typeof dict)["en"];
const Ctx = createContext<{ lang: Lang; setLang: (l: Lang) => void; t: (k: Key) => string }>({
  lang: "en",
  setLang: () => {},
  t: (k) => dict.en[k],
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>("en");
  useEffect(() => {
    const saved = localStorage.getItem("tt-lang");
    if (saved === "ur" || saved === "en") setLang(saved);
  }, []);
  useEffect(() => {
    localStorage.setItem("tt-lang", lang);
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ur" ? "rtl" : "ltr";
  }, [lang]);
  return <Ctx.Provider value={{ lang, setLang, t: (k) => dict[lang][k] }}>{children}</Ctx.Provider>;
}

export const useI18n = () => useContext(Ctx);
