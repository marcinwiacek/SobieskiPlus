# Artykuły
* Milestone 1 (22.3.2020)
** http://mwiacek.com/www/?q=node/393 albo https://www.dobreprogramy.pl/marcinw2/Jak-napisac-kompaktowego-CMS-runda-druga-czyli-Sobieski-z-Plusem-Milestone,106946.html
** https://www.fantastyka.pl/hydepark/pokaz/24257

# Znane rzeczy i todo z node.JS:
* Firefox: menu przewija się z ciemnym motywem (błąd FF?)
* Edge: nie chowa pasków postępu
* change password przez stronę newuser
* auto odswiezanie wszystkich stron -> częściowo done
* deaktywacja użytkownika
* +- (punkty)
* facebook
* sesje Google - szukanie czy user wylogowany
* suneditor -> zamiana https, dobre wykrywanie pustej zawartosci text.striphtml.trim....
* notka na stronie usera
* blad -> usuwanie taxonomii z tekstu
* subskrypcje web-push (wymagają Notifications z przeglądarki)
* zglaszanie do moderacji
* kolejki tekstów
* blad -> jak zmieniany jest tylko status tekstu, to zmieniane jest pole When i data tekstu

# Obecne funkcjonalności
* pokazywanie popup przy otrzymaniu wiadomości chat
* chatowanie (dodawanie i wysyłanie)
* edycja i wyświetlanie tekstów (włącznie z przyklejaniem i blokowaniem nadpisywania)
* listy tekstów
* tworzenie kont, login/logout (włącznie z Google), przypominanie hasła i weryfikacja email

# Tworzenie wielu plików z danymi z istniejących:

```
for /l %f in (1,1,800) do copy 1.jpg %f.jpg
```

# Instalacja package do Google (gdy jest używana biblioteka):

```
npm install google-auth-library --save
npm install nodemailer
```

```
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

# Znane rzeczy z PHP (ostatnia wersja 13.3.2020):
1. przy przeładowaniu push.php teoretycznie możemy zgubić komentarz (?)
2. hasła są obecnie plain textem w pliku usera
3. brak obslugi URL /profil/1234
4. brak dodawania, deaktywacji i edycji usera
5. brak zglaszania komentarzy
6. brak push dla list
itd. itd.
