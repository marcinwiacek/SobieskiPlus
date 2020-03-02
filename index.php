<?php

//filesystem limit for one folder
$gMaxPerFolder=10000000;

function strncmp_startswith($haystack, $needle)
{
    return strncmp($haystack, $needle, strlen($needle)) === 0;
}

function readFileContent($fileName)
{
    $nodeFileName = $fileName;

    $handle = @fopen($nodeFileName, "r");
    if ($handle == false) {
        header('HTTP/1.1 404 Not Found');
        exit;
    }

    $text = fread($handle, filesize($nodeFileName));
    if (!$text) {
        header('HTTP/1.1 404 Not Found');
        exit;
    }
    fclose($handle);

    // support for UTF8 files
    if (ord($text[0])==239) {
        return substr($text, 3);
    }
    return $text;
}

abstract class DecodingLevel
{
    const MainHeaders = 1;
    const MainText = 2;
    const CommentHeaders = 3;
    const CommentText = 4;
}

// one weakness - we don't have edits for comments
// maybe <!--commentedit?-->
function decodeFileContent0($text,$headersOnly,$normalHeaders,$commentInFile,$commentInArr,$commentHeaders)
{
    $arr = array();
    $arr["Text"]="";
    $parsingLevel = DecodingLevel::MainHeaders;
    if ($headersOnly) {
        foreach(preg_split("/\\r\\n|\\r|\\n/", $text) as $singleLine) {
            if ($singleLine == $commentInFile) {
                $parsingLevel = DecodingLevel::CommentHeaders;
                continue;
            } else if ($singleLine == "<!--change-->") {
                $parsingLevel = DecodingLevel::MainHeaders;
                continue;
            }
            if ($parsingLevel== DecodingLevel::MainHeaders) {
                if ($singleLine == "") {
                    $parsingLevel = DecodingLevel::MainText;
                } else {
                    $x = explode(":", $singleLine);
                    if (count($x)!=2) { continue;
                    }
                    if (!in_array($x[0], $normalHeaders)) { 
                        continue;
                    }
                    $arr[$x[0]] = $x[1]; 
                }
            }
        }
        return $arr;
    }
    foreach(preg_split("/\\r\\n|\\r|\\n/", $text) as $singleLine) {
        if ($singleLine == $commentInFile) {
            if (isset($comment)) {
                if (!isset($arr[$commentInArr])) {
                    $arr[$commentInArr] = array();
                }
                array_push($arr[$commentInArr], $comment);
            }
            $parsingLevel = DecodingLevel::CommentHeaders;
            $comment = array();
            $comment["Text"] = "";
            continue;
        } else if ($singleLine == "<!--change-->") {
            $parsingLevel = DecodingLevel::MainHeaders;
            continue;
        }

        switch ($parsingLevel) {
        case DecodingLevel::MainHeaders:
            if ($singleLine == "") {
                $parsingLevel = DecodingLevel::MainText;
            } else {
                $x = explode(":", $singleLine);
                if (count($x)!=2) { break;
                }
                if (!in_array($x[0], $normalHeaders)) {
                    break;
                }
                $arr[$x[0]] = $x[1];
            }
            break;
        case DecodingLevel::MainText:
            $arr["Text"] = $arr["Text"].$singleLine."\n";
            break;
        case DecodingLevel::CommentHeaders:
            if ($singleLine == "") {
                $parsingLevel = DecodingLevel::CommentText;
            } else {
                $x = explode(":", $singleLine);
                if (count($x)!=2) { break;
                }
                if (!in_array($x[0], $commentHeaders)) {
                    break;
                }
                $comment[$x[0]] = $x[1];
            }
            break;
        case DecodingLevel::CommentText:
            $comment["Text"] = $comment["Text"].$singleLine."\n";
            break;
        }
    }

    if (isset($comment)) {
        if (!isset($arr[$commentInArr])) {
            $arr[$commentInArr] = array();
        }
        array_push($arr[$commentInArr], $comment);
    }

    return $arr;
}

function decodeFileContent($text,$headersOnly)
{
        return decodeFileContent0(
            $text, $headersOnly,
            array("Title","Author","Taxonomy","MainPage","When","State","Type","Species"),
            "<!--comment-->",
            "Comments",
            array("Title","Author","When")
        );
}

function GetPagesList($pageNum, $stateList, $typeList, $speciesList, $taxonomy) 
{
    $files = array();
    foreach (scandir("teksty", 0) as $file) {
        if (is_file("teksty/$file") && preg_match("/^(.*)\.txt/", $file, $fileNameArray)) {
            $text = readFileContent("teksty/".$fileNameArray[1].".txt");
            $arr = decodeFileContent($text, true);
            if (!isset($arr["State"]) || !in_array($arr["State"], $stateList)) { continue;
            }
            if (!isset($arr["Type"]) || !in_array($arr["Type"], $typeList)) { continue;
            }
            if (!isset($arr["Species"]) || !in_array($arr["Species"], $speciesList)) { continue;
            }
            if ($taxonomy!="" && isset($arr["Taxonomy"])) {
                $tax = explode(",", $arr["Taxonomy"]);
                if (!in_array($taxonomy, $tax)) { continue;
                }
            }
            $files[$fileNameArray[1]] = $arr;
        }
    }
    return $files;
}

$podstronyType = array();
$podstronyType["opowiadania"]=array("opowiadanie","szort");
$podstronyType["publicystyka"]=array("artykul","felieton");

// showing text page
// for example: opowiadanie/pokaz/1
if (isset($_GET["q"]) && preg_match("/^([a-z]+)\/pokaz\/([0-9\-]+)$/", $_GET["q"], $id)) {
    if (!isset($podstronyType[$id[1]])) {
        header('Location: '.$_SERVER['PHP_SELF']);
        exit(0);
    }

    $ft = readFileContent("teksty/".$id[2].".txt");
    $arr = decodeFileContent($ft, false);
    if (!in_array($arr["Type"], $podstronyType[$id[1]])) { 
        header('Location: '.$_SERVER['PHP_SELF']);
        exit(0);
    }

    $text = readFileContent("templates/entry.txt");
    $text = str_replace("<!--MENU-->", readFileContent("templates/menu.txt"), $text);
    $text = str_replace("<!--JS-->", readFileContent("templates/js.txt"), $text);
    $text = str_replace("<!--TITLE-->", $arr["Title"], $text);
    $text = str_replace("<!--USER-->", $arr["Author"], $text);
    $text = str_replace("<!--TEXT-->", $arr["Text"], $text);
    $text = str_replace("<!--TYPE-->", $arr["Type"], $text);
    $text = str_replace("<!--SPECIES-->", $arr["Species"], $text);
    if (isset($arr["Comments"])) {
        $template0 = readFileContent("templates/comment.txt");
        $txt = "";
        foreach($arr["Comments"] as $comment) {
            $template = $template0;
            $template = str_replace("<!--USER-->", $comment["Author"], $template);
            $template = str_replace("<!--TITLE-->", $comment["Title"], $template);
            $template = str_replace("<!--WHEN-->", $comment["When"], $template);
            $template = str_replace("<!--TEXT-->", $comment["Text"], $template);

            $txt = $txt.$template;
        }
        $text = str_replace("<!--COMMENTS-->", $txt, $text);
    }
    $text = str_replace("<!--COMMENTEDIT-->", readFileContent("templates/commentedit.txt"), $text);

    echo $text;
    return;
}

$podstronyState = array();
$podstronyState["opowiadania"]=array("biblioteka","beta","archiwum");
$podstronyState["publicystyka"]=array("artykuly","felietony","poradniki");

// for example opowiadania/biblioteka
if (isset($_GET["q"]) && preg_match("/^([a-z]+)\/([a-z]+)$/", $_GET["q"], $id)) {
    if (isset($podstronyState[$id[1]]) && in_array($id[2], $podstronyState[$id[1]])) {
        $list = GetPagesList(1, array($id[2]), $podstronyType[$id[1]], array("inne","scifi"), "");
    } else {
        header('Location: '.$_SERVER['PHP_SELF']);
        exit(0);
    }

    $text = readFileContent("templates/list.txt");
    $text = str_replace("<!--TITLE-->", "", $text);
    $text = str_replace("<!--MENU-->", readFileContent("templates/menu.txt"), $text);
    $text = str_replace("<!--JS-->", readFileContent("templates/js.txt"), $text);

    if (!empty($list)) {
        $template0 = readFileContent("templates/listentry.txt");
        $txt="";
        foreach($list as $fileName => $arr) {
            $template = $template0;
            $template = str_replace("<!--USER-->", $arr["Author"], $template);
            $template = str_replace("<!--TITLE-->", "<a href=\"?q=".$id[1]."/pokaz/$fileName\">".$arr["Title"]."</a>", $template);
            $template = str_replace("<!--TYPE-->", $arr["Type"], $template);
            $template = str_replace("<!--SPECIES-->", $arr["Species"], $template);
            $template = str_replace("<!--WHEN-->", $arr["When"], $template);
            $txt = $txt.$template;
        }
        $text = str_replace("<!--LIST-->", $txt, $text);
    }

    echo $text;
    return;
}
if (isset($_POST["q"]) && $_POST["q"]=="upload_new_page" && isset($_POST["tekst"]) && isset($_POST["comment"])) {
}
if (isset($_POST["q"]) && $_POST["q"]=="edit_page" && isset($_POST["tekst"]) && isset($_POST["comment"])) {
}
if (isset($_POST["q"]) && $_POST["q"]=="login" && isset($_POST["tekst"]) && isset($_POST["comment"])) {
}
if (isset($_POST["q"]) && $_POST["q"]=="logout" && isset($_POST["tekst"]) && isset($_POST["comment"])) {
}
if (isset($_POST["q"]) && $_POST["q"]=="new_user" && isset($_POST["tekst"]) && isset($_POST["comment"])) {
}
if (isset($_POST["q"]) && $_POST["q"]=="edit_user" && isset($_POST["tekst"]) && isset($_POST["comment"])) {
}
if (isset($_POST["q"]) && $_POST["q"]=="get_page_updates" && isset($_POST["tekst"]) && isset($_POST["comment"])) {
}
if (isset($_POST["q"]) && $_POST["q"]=="upload_comment" && isset($_POST["tekst"]) && isset($_POST["comment"])) {
    //checking for login
    //checking for correct filename protection
    if (file_exists("teksty/".$_POST["tekst"].".txt")) {
        $handle = @fopen("teksty/".$_POST["tekst"].".txt", "a");
        //checking for <!--comment--> and others
        //saving pictures separately
        fwrite($handle, "\n<!--comment-->\n".rawurldecode($_POST["comment"]));
        fclose($handle);
    }

    exit(0);
}
// profil/1234
if (isset($_GET["q"]) && preg_match("/^profil\/([0-9\-]+)$/", $_GET["q"], $id)) {
}

$text = readFileContent("templates/main.txt");
$text = str_replace("<!--TITLE-->", "", $text);
$text = str_replace("<!--MENU-->", readFileContent("templates/menu.txt"), $text);
$text = str_replace("<!--JS-->", readFileContent("templates/js.txt"), $text);

echo $text;

?>
