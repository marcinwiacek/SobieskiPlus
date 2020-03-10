Tworzenie wielu plików z danymi z istniejących:
for /l %f in (1,1,800) do copy 1.jpg %f.jpg

Znane błędy:
1. przy przeładowaniu push.php teoretycznie możemy zgubić komentarz (?)
2. hasła są obecnie plain textem w pliku usera
3. brak obslugi URL /profil/1234
4. brak dodawania, deaktywacji i edycji usera
5. brak zglaszania komentarzy
6. brak push dla list
itd. itd.