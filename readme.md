Full working minimalistic file-based CMS using nodeJS, SSE and many modern technologies. For license ask marcin@mwiacek.com - for example all OSS licenses (like MIT, Apache and GPL2) can be discussed.

# Artykuły
* Milestone 1 (22.3.2020)
  * http://mwiacek.com/www/?q=node/393 albo https://www.dobreprogramy.pl/marcinw2/Jak-napisac-kompaktowego-CMS-runda-druga-czyli-Sobieski-z-Plusem-Milestone,106946.html
  * https://www.fantastyka.pl/hydepark/pokaz/24257
* Milestone 2 (18.4.2020)
  * https://www.dobreprogramy.pl/marcinw2/Jeden-uparty-kaleczy-JavaScript-czyli-Sobieski-MileStone,107488.html
  * https://www.dobreprogramy.pl/marcinw2/Hey-Joe-Potrzymaj-mi-piwo-dlaczego-w-Polsce-nie-ma-wlasnych-OS-ani-przegladarek-ani-wiekszych-pakietow,107517.html
* Milestone 3 (11.5.2020)
  * https://www.dobreprogramy.pl/marcinw2/Raport-z-postepu-prac-czyli-Sobieski-MileStone,107845.html

# todo z node.JS:
* facebook
* sesje z Google -> szukanie czy user wylogowany + usuwanie nieaktywnych
* subskrypcje web-push (wymagają Notifications z przeglądarki)
* zglaszanie do moderacji
* obsługa ukrywania komentarzy w becie prywatnej (kwestie formatu)
* obsługa deaktywacji tekstów i userów
* dodawanie tagów przez www
* dodawanie konkursów przez www
* notyfikacje o nowych wiadomościach w menu (potrzebne pole, kiedy user ostatni raz oglądał swoją stronę)

# Znane rzeczy z node.JS:
* Firefox: menu przewija się z ciemnym motywem (błąd FF?)
* Edge: nie chowa pasków postępu (do sprawdzenie, czy jeszcze występuje)
* suneditor -> zamiana https przy pisaniu, dobre wykrywanie pustej zawartosci text.striphtml.trim....
* błędy przy parsowaniu plików są średnio jasne

# Obecne funkcjonalności
* chat: pokazywanie popup przy otrzymaniu wiadomości (można zapisać się tylko do określonych chatów)
* chat: dodawanie i wysyłanie
* chat i komentarze: załączanie sygnaturek
* teksty: edycja i wyświetlanie (przyklejanie i blokowanie nadpisywania; pokazywanie wersji tekstu i teasera)
* teksty: listy i kolejki prywatne
* teksty: betowanie prywatne i publiczne
* konta: tworzenie, login/logout (włącznie z Google), przypominanie hasła i weryfikacja email, notka na stronie, sig
* konta: różne poziomy użytkowników
* konta: wznawianie połączeń z serwerem (SSE) i przeładowanie, jeśli sesja straciła ważność (np. restart serwera)
* konta: (wy)logowywanie usera ze wszystkich zakładek przy tej samej sesji
* konta: banowanie na określony czas
* konta: ukrywanie usera przez pole Active=0
* komentarze: możliwość edycji (na razie www obsługuje tylko dane z pliku)

# Tworzenie wielu plików z danymi z istniejących:

```
for /l %f in (1,1,800) do copy 1.jpg %f.jpg
```

# Instalacja (Google auth tylko jak będzie używana biblioteka)

```
npm install google-auth-library --save
npm install nodemailer
npm -g install js-beautify
```

# Generacja kluczy do HTTPS:

```
openssl req -x509 -newkey rsa:2048 -nodes -sha256 -subj '/CN=localhost' \
-keyout localhost-privkey.pem -out localhost-cert.pem
```

# Linki:
* https://medium.com/@thomashellstrom/use-google-as-login-in-your-web-app-with-oauth2-352f6c7f10e6
* https://developers.google.com/identity/sign-in/web/backend-auth
* https://www.cssscript.com/minimal-wysiwyg-editor-pure-javascript-suneditor/
* https://blog.sessionstack.com/how-javascript-works-the-mechanics-of-web-push-notifications-290176c5c55d

# Znane rzeczy z PHP (ostatnia wersja 13.3.2020):
1. przy przeładowaniu push.php teoretycznie możemy zgubić komentarz (?)
2. hasła są obecnie plain textem w pliku usera
3. brak obslugi URL /profil/1234
4. brak dodawania, deaktywacji i edycji usera
5. brak zglaszania komentarzy
6. brak push dla list
itd. itd.
