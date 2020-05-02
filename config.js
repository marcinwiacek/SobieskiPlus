const hostname = '127.0.0.1';
const port = 3000;
const onThePage = 5;

//NOTE: adding Polish chars needs changing regular expressions
var podstronyType = [];
podstronyType["opowiadania"] = ["opowiadanie", "szort"];
podstronyType["publicystyka"] = ["artykuł", "felieton", "poradnik"];
podstronyType["książki"] = ["książka", "recenzja"];
podstronyType["hydepark"] = ["inne"];

var podstronyState = [];
podstronyState["opowiadania"] = ["szkic", "biblioteka", "poczekalnia", "beta"];
podstronyState["publicystyka"] = ["szkic", "poczekalnia", "biblioteka"];
podstronyState["książki"] = ["szkic", "poczekalnia", "biblioteka"];
podstronyState["hydepark"] = ["szkic", "biblioteka"];

const tag = ["postapo", "upadek cywilizacji", "mrok"];
const special = ["przyklejonegłówna", "główna", "przyklejone", "złoto", "srebro"]; //wymaga uprawnien admina

const enableGoogleWithToken = true;

const GoogleSignInToken = "YOUR_CLIENT_ID.apps.googleusercontent.com";

const sortParam = ["ostatni", "ileKomentarzy", "autor", "ostatniKomentarz", "punkty"];

const mailSupport = true;

const sessionValidity = 60 * 1000; // 60 seconds; session validity setup after creation or using
const sessionRefreshValidity = 30 * 1000; // 30 seconds; refreshing token
