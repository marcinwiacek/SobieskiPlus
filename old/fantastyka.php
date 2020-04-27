<?php

// (c) 02.2020 by Marcin Wiącek mwiacek.com
// Formatted with phpcbf
//
// skrypt pobiera pliki z fantastyka.pl
// i tworzy plik epub we wskazanym katalogu.
//
// wymagany plik cover.jpg w aktualnym katalogu
// i komendy zip, cd i mv

// ------ CONFIG -----------
$path = "/tmp";
$set = 1; //1 = biblioteka, 2 = poczekalnia (bez tekstów w bibliotece), 3 = archiwum (bez tekstów w bibliotece)
        //4 = kolejka (wymaga parametrów logowania; niesprawdzone)
$log = false;
$allPages = true;
$allowResume = true; // when true, doesn't download pages when they exist on disk (we check for .xhtml only)
$downloadArticles = true;
$userNumber = ""; // profile number for user; empty means all users
$downloadImages = false; // valid only when $downloadArticles = true; when false replacing <img> with <a>
                            // TODO: pobieranie obrazków z innych serwerów niż fantastyka.pl

$startPage = 1; // used when $allPages = false
$endPage = 39; // used when $allPages = false
$downloadOnlyFew = false; // download only 5 articles when $downloadArticles=true; useful for script testing

// -------------------------

$userID=1;

if ($set == 1) {
    $word = "biblioteka";
} else if ($set == 2) {
    $word = "poczekalnia";
} else if ($set == 3) {
    $word = "archiwum";
} else if ($set == 4) {
    $word = "kolejka";

    echo "Please enter user: ";
    $handle = fopen("php://stdin", "r");
    $user = trim(fgets($handle));
    fclose($handle);

    echo "Please enter password: ";
    $handle = fopen("php://stdin", "r");
    $password = trim(fgets($handle));
    $password = urlencode($password);
    fclose($handle);

    $file = file_get_contents("https://www.fantastyka.pl/");
    //    var_dump($http_response_header);
    $form_build_id=findBetween($file, "name=\"_csrf_token\" value=\"", "", "\"");

    $cookie = "";
    foreach ($http_response_header as &$value) {
        if (strpos($value, "Set-Cookie: ")===false) {
            continue;
        }
        $cookie = findBetween($value, "Set-Cookie: ", "", "; ");
        break;
    }

    $options = array(
    'http'=>array(
        'method'=>"POST",
            'header'=>"Content-Type: application/x-www-form-urlencoded\r\n".
                "Cookie: $cookie\r\n",
            'content'=>"_csrf_token=$form_build_id&".
            "_remember_me=on&".
                "_username=$user&".
                "_password=$password&".
                "_submit="
        )
    );

    $context = stream_context_create($options);
    $file = file_get_contents("https://www.fantastyka.pl/login_check", false, $context);
    //    var_dump($http_response_header);

    $cookie = "";
    $second = false;
    foreach ($http_response_header as &$value) {
        if (strpos($value, "Set-Cookie: ")===false) {
            continue;
        }
        if ($cookie != "") {
            $cookie = $cookie."; ";
            $second = true;
        }
        $cookie = $cookie.findBetween($value, "Set-Cookie: ", "", "; ");
    }

    if (!$second) {
        echo "Sorry Gregory, wrong credentials\n";
        exit;
    }

    $options = array(
    'http'=>array(
            'method'=>"GET",
            'header'=>"Cookie: $cookie\r\n"
    )
    );
    $context = stream_context_create($options);
} else {
    echo("Unknown set!\n");
    exit;
}
if ($allPages) {
    $startPage = 1;
}

$tocContentOpf1="";
$tocContentOpf2="";
$tocContentOpf3="";
$tocTocNCX="";
$tocTocXHTML="";

function findNext($text, $start)
{
    $f2 = strstr($text, $start);
    return substr($f2, strlen($start));
}

function findBetween($text, $start, $start2, $end)
{
    $f2 = findNext($text, $start);
    if ($start2!="") {
        $f2 = findNext($f2, $start2);
    }
    return strstr($f2, $end, true);
}

function getMon($t)
{
    if ($t=="01") { return "Jan";
    }
    if ($t=="02") { return "Feb";
    }
    if ($t=="03") { return "Mar";
    }
    if ($t=="04") { return "Apr";
    }
    if ($t=="05") { return "May";
    }
    if ($t=="06") { return "Jun";
    }
    if ($t=="07") { return "Jul";
    }
    if ($t=="08") { return "Aug";
    }
    if ($t=="09") { return "Sep";
    }
    if ($t=="10") { return "Oct";
    }
    if ($t=="11") { return "Nov";
    }
    if ($t=="12") { return "Dec";
    }
    return "";
}

function addUserFile($author)
{
    global $userID,$path;

        $found=false;
    foreach (scandir("$path/users") as $key => $filename) {
        if (!in_array($filename, array(".","..")) && !is_dir("$path/users/$filename")
            && strstr($filename, ".txt") 
        ) {
                $fx=file_get_contents("$path/users/$filename");
            if (strstr($fx, "Who:$author\n")) {
                $found = true;
                break;
            }
        }
    }

    if (!$found) {
        file_put_contents("$path/users/$userID.txt", "Who:$author\nWhen:26 Apr 2020\nPass:aaa\nMail:marcin@mwiacek.com\nConfirmMail:0\nLevel:2\n");
        $userID++;
    }

}

function formatMyText($text)
{
        $text = str_replace("<br>", "<br />", $text);
        $text = str_replace("<hr>", "<hr />", $text);
        $text = preg_replace('/<p(.*?)>/', "<p\\1 />", $text);
        $text = str_replace("</p>", "", $text);
        $text = str_replace("<p />&nbsp; <p />", "<p />", $text);
        $text = str_replace("<p /><p />", "<p />", $text);
        $text = str_replace("<p /><p />", "<p />", $text);
        $text = str_replace("<br /><br />", "<br />", $text);
        $text = str_replace("<hr /><p />", "<hr />", $text);
        $text = str_replace("&nbsp;", " ", $text);
        $text = str_replace("\t\t", "\t", $text);
        $text = str_replace("  ", " ", $text);
        $text = str_replace(" <p ", "<p ", $text);
        $text = str_replace("<p /> <hr />", "<hr />", $text);
        $text = str_replace("&oacute;", "ó", $text);
        $text = str_replace("\n\t<span class=\"koniec\">Koniec</span>", "", $text);
        $text = str_replace("Tagi: , ", "Tagi: ", $text);

    return trim($text);
}


function processArticle($id,$title,$num)
{
    global $path, $downloadImages, $tocContentOpf1, $allowResume, $log, $set, $context, $userID;

    if ($allowResume && file_exists("$path/texts/$id.txt")) { return;
    }

    if ($set == 4) {
        $f=file_get_contents("https://www.fantastyka.pl/opowiadania/pokaz/".$id, false, $context);
    } else {
        $f=file_get_contents("https://www.fantastyka.pl/opowiadania/pokaz/".$id);
    }

    $descriptionOrHr = trim(findBetween($f, "<div class=\"clear linia\" style=\"margin-top: 1px;\"></div>", "", "</div>"));
    if ($descriptionOrHr != "") { $descriptionOrHr = $descriptionOrHr."\n<!--teaser-->\n";
    }

    $author = findBetween(
        $f, "<p class=\"naglowek-kom\"><a class=\"login\" href=\"/profil/", ">", "<"
    );
    $author = str_replace("&", "&amp;", $author);

    $info = findBetween($f, "<p class=\"data\">", "", "<");

    $data = findBetween($info, "|", "", "|");
    $d = $data[1].$data[2]." ".getMon($data[4].$data[5])." 20".$data[7].$data[8]." ".$data[14].$data[15].":".$data[17].$data[18].":00";

    if ($log) { file_put_contents("$path/log", "before tags\n", FILE_APPEND);
    }
    $tags = "";
    $f2 = $f;
    while (true) {
        $t=" class=\"znajomy\">";
        if (strstr($f2, $t)) {
            $f2 = findNext($f2, $t);
            $tags = $tags.", ".trim(strstr($f2, "</", true));
            continue;
        }
        break;
    }
    $f2 = $f;
    while (true) {
        $t=" class=\"redakcja\">";
        if (strstr($f2, $t)) {
            $f2 = findNext($f2, $t);
            $tags = $tags.", ".trim(strstr($f2, "</", true));
            continue;
        }
        break;
    }
    $f2 = $f;
    while (true) {
        $t="<a href=\"/opowiadania/tag/s/";
        if (strstr($f2, $t)) {
            $f2 = findNext($f2, $t);
            $f2 = findNext($f2, ">");
            $tags = $tags.", ".trim(strstr($f2, "</a>", true));
            continue;
        }
        break;
    }
    if (strstr($f, "<img src=\"/images/srebro.png\" class=\"piorko\" />")) { $tags = $tags.", <b>Srebrne PIÓRKO</b>";
    }
    if (strstr($f, "<img src=\"/images/zloto.png\" class=\"piorko\" />")) { $tags = $tags.", <b>ZŁOTE PIÓRKO</b>";
    }
    if ($tags!="") { $tags="Tagi: $tags<br>\n";
    }
    $tags = str_replace("&", "&amp;", $tags);
    if ($log) { file_put_contents("$path/log", "after tags\n", FILE_APPEND);
    }

    $txt = findBetween(
        $f, "<section class=\"opko no-headline\">", "<article>", "</article>"
    );

    if ($downloadImages) {
        $f2 = $txt;
        while (true) {
            $t = "src=\"http://www.fantastyka.pl/upload/";
            if (!strstr($f2, $t)) { break;
            }
            $f2 = strstr($f2, $t);
            $f2 = substr($f2, 5);
            $url = strstr($f2, "\"", true);
            if ($log) {            file_put_contents("$path/log", "image $url\n", FILE_APPEND);
            }
            $f3=file_get_contents(str_replace(" ", "%20", $url));
            $tmp=explode("/", "$url");
            $localfile = end($tmp);
            echo "localfile is $url $localfile\n";
            file_put_contents("$path/OEBPS/$localfile", $f3);
            $tocContentOpf1=$tocContentOpf1."<item id=\"$localfile\" media-type=\"image/jpeg\" href=\"$localfile\" properties=\"image\" />\n";
        }
        $txt = str_replace("\"http://www.fantastyka.pl/upload/", "\"", $txt);
    } else {
        $txt = preg_replace('/<img (.*?) \/>/', " <a \\1>Obrazek</a> ", $txt);
        $txt = preg_replace('/src=\"(.*?)\"/', "href=\"\\1\"", $txt);
    }

    $txt = "Title:$title\n".
    "Who:$author\nWhen:$d\nState:biblioteka\nType:opowiadanie\n\n".
    //    "$tags".
    //    "$info\n".
    "$descriptionOrHr".
    formatMyText($txt)."\n";

    addUserFile($author);

    $f2=$f;
    $f2=findNext($f2, "<h3>Komentarze</h3>");

    while(true) {
        if (!strstr($f2, "<article>")) { break;
        }
        $f2 = findNext($f2, "<article>");

        $info = findBetween($f2, "<p class=\"data\">", "", "span class");
        $data = findBetween($info, "|", "", "<");
        //        echo $data;
        $d = $data[1].$data[2]." ".getMon($data[4].$data[5])." 20".$data[7].$data[8]." ".$data[14].$data[15].":".$data[17].$data[18].":00";
        //        echo $d;

        $author = findBetween(
            $f2, "<p class=\"naglowek-kom\"><a class=\"login\" href=\"/profil/", ">", "<"
        );
        $author = str_replace("&", "&amp;", $author);
        //        echo $author;

        $text = findBetween($f2, "</aside>", "", "<div class=\"clear");
        $text = str_replace("		</div>", "", $text);

        //        echo $text;

        $txt=$txt."<!--comment-->\nWho:$author\nWhen:$d\n\n".formatMyText($text)."\n";

        addUserFile($author);
    }

    file_put_contents("$path/texts/$id.txt", $txt);
}

$path = $path."/".$word;

if (!$allowResume && file_exists("$path")) {
    echo("Directory $path exists! Delete it first!\n");
    exit;
}
mkdir("$path", 0700);

mkdir("$path/texts", 0700);
mkdir("$path/users", 0700);

$num=1;
$pagenum=$startPage;
if ($log) { file_put_contents("$path/log", "start");
}
while (true) {
    if ($set == 4) {
        if ($pagenum==1) {
            $f=file_get_contents("https://www.fantastyka.pl/opowiadania/wszystkie/w/w/$word/0/d", false, $context);
        } else {
            //wild guess
            $f=file_get_contents("https://www.fantastyka.pl/opowiadania/wszystkie/w/w/$word/0/d/$pagenum", false, $context);
        }
    } else {
        if ($pagenum==1) {
            $f=file_get_contents("https://www.fantastyka.pl/opowiadania/$word");
        } else {
            if ($set == 3) {
                $f=file_get_contents("https://www.fantastyka.pl/opowiadania/$word/d/$pagenum");
            } else {
                $f=file_get_contents("https://www.fantastyka.pl/opowiadania/$word/w/w/w/0/d/$pagenum");
            }
        }
    }
    echo "reading page $pagenum from $word\n";
    if ($log) {    file_put_contents("$path/log", "reading page $pagenum from $word\n", FILE_APPEND);
    }
    $f2 = $f;
    while (true) {
        $t = "<div class=\"autor\"><a href=\"/profil/";
        if (!strstr($f2, $t)) { break;
        }
        $f2 = findNext($f2, $t);
        $userId = strstr($f2, "\"", true);
        if ($userNumber!="" && strcmp($userNumber, $userId)) { continue;
        }

        $t = "><a href=\"/opowiadania/pokaz/";
        if (!strstr($f2, $t)) { break;
        }
        $f2 = findNext($f2, $t);
        $id = strstr($f2, "\"", true);

        if ($id != "10823" && $id != "8313") {
            echo "id is ".$id;
            //            echo "user id is $userId id is ".$id;
            if ($log) {            file_put_contents("$path/log", "id is $id\n", FILE_APPEND);
            }

            if ($set == 3) {
                $params = strstr($f2, "<div class=\"clear linia\"></div>", true);
            }

            $f2 = findNext($f2, ">");
            if ($id == "56842934") {
                $title="DZIEŃ (bez) PRĄDU! - Czuby Aka kontra Czterech Jeźdźców Apo Kalipsy";
            } else {
                $title = strstr($f2, "<", true);
                $title = preg_replace('/(&(?!#|amp;))/', "&amp;", $title);
            }

            echo " title is ".$title."\n";
            if ($log) {            file_put_contents("$path/log", "title is $title\n", FILE_APPEND);
            }

            if ($set == 3 && strstr($params, "<div class=\"punkty\" title=\"opowiadanie w bibliotece\">OK<div>bib</div></div>")) {
                echo "  library\n";
                if ($log) {            file_put_contents("$path/log", "library\n", FILE_APPEND);
                }
            } else {
                if ($downloadArticles) { processArticle($id, $title, $num);
                }

                $num++;
            }
        }

        if ($downloadOnlyFew && $num==5) { break;
        }
    }
    if ($downloadOnlyFew && $num==5) { break;
    }

    if ($allPages) {
        if (strstr($f, "/$pagenum\" title=\"koniec\">") 
            || strstr($f, "$word/".($pagenum-1)."/d\" title=\"koniec\">")
        ) { break;
        }
    } else {
        if ($pagenum==$endPage) { break;
        }
    }
    $pagenum++;
}

if ($set == 4) {
    file_get_contents("https://www.fantastyka.pl/logout", false, $context);
    //    var_dump($http_response_header);
}

echo ($num-1)." texts processed\n";

?>
