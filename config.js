const hostname = '127.0.0.1';
const port = 3000;
const onThePage = 5;

//NOTE: adding Polish chars needs changing regular expressions
var podstronyType = new Array();
podstronyType["opowiadania"] = new Array("opowiadanie", "szort");
podstronyType["publicystyka"] = new Array("artykuł", "felieton", "poradnik");
podstronyType["książki"] = new Array("książka", "recenzja");
podstronyType["hydepark"] = new Array("inne");

var podstronyState = new Array();
podstronyState["opowiadania"] = new Array("szkic", "biblioteka", "poczekalnia", "beta");
podstronyState["publicystyka"] = new Array("szkic", "poczekalnia", "biblioteka");
podstronyState["książki"] = new Array("szkic", "poczekalnia", "biblioteka");
podstronyState["hydepark"] = new Array("szkic", "biblioteka");

var taxonomy = new Array("postapo", "upadek cywilizacji", "mrok");
var specialTaxonomy = new Array("przyklejonegłówna", "główna", "przyklejone", "złoto", "srebro"); //wymaga uprawnien admina

const enableGoogleWithToken = true;

const GoogleSignInToken = "YOUR_CLIENT_ID.apps.googleusercontent.com";

const sortParam = new Array("ostatni", "ileKomentarzy", "autor", "ostatniKomentarz");

const mailSupport = true;
