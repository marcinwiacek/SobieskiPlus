Tworzenie wielu plik�w z danymi z istniej�cych:
for /l %f in (1,1,800) do copy 1.jpg %f.jpg

Znane b��dy:
1. po akcji login trzeba od�wie�y� r�cznie stron�
2. trzeba doda� 2 lub 3x komentarze, �eby si� zacz�y od�wie�a�
   (co� z formatem?)
3. przy prze�adowaniu push.php teoretycznie mo�emy zgubi� komentarz
4. has�a s� obecnie plain textem w pliku usera
