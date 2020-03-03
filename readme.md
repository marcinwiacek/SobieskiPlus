Tworzenie wielu plików z danymi z istniej¹cych:
for /l %f in (1,1,800) do copy 1.jpg %f.jpg

Znane b³êdy:
1. po akcji login trzeba odœwie¿yæ rêcznie stronê
2. trzeba dodaæ 2 lub 3x komentarze, ¿eby siê zaczê³y odœwie¿aæ
   (coœ z formatem?)
3. przy prze³adowaniu push.php teoretycznie mo¿emy zgubiæ komentarz
4. has³a s¹ obecnie plain textem w pliku usera
