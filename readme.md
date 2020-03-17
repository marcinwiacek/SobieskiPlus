Tworzenie wielu plików z danymi z istniejących:

for /l %f in (1,1,800) do copy 1.jpg %f.jpg

Firefox: menu przewija się z ciemnym motywem (błąd FF?)

Generacja kluczy do HTTPS:

openssl req -x509 -newkey rsa:2048 -nodes -sha256 -subj '/CN=localhost' \
  -keyout localhost-privkey.pem -out localhost-cert.pem


Znane błędy:
specialtaxonomy undefined
zapisuje zawsze całość (a nie tylko zmienione elementy)
save powinno bec enabled po każdej zmianie



Znane błędy PHP (ostatnia wersja 13.3.2020):
1. przy przeładowaniu push.php teoretycznie możemy zgubić komentarz (?)
2. hasła są obecnie plain textem w pliku usera
3. brak obslugi URL /profil/1234
4. brak dodawania, deaktywacji i edycji usera
5. brak zglaszania komentarzy
6. brak push dla list
itd. itd.
