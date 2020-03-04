<?php
//session_write_close();
ignore_user_abort(false);
set_time_limit(60);//10 minutes
header('Content-Type: text/event-stream');
header('Cache-Control: no-cache');

function str_replace_first($search, $replace, $subject) 
{
    $pos = strpos($subject, $search);
    if ($pos !== false) {
        return substr_replace($subject, $replace, $pos, strlen($search));
    }
    return $subject;
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
                    if (count($x)>=2 && in_array($x[0], $normalHeaders)) { 
                        $arr[$x[0]] = substr($singleLine, strlen($x[0])+1, strlen($singleLine)-strlen($x[0])); 
                    }
                }
            }
        }
        $arr["When"] = strtotime($arr["When"]);
        return $arr;
    }
    $arr["Text"]="";
    foreach(preg_split("/\\r\\n|\\r|\\n/", $text) as $singleLine) {
        if ($singleLine == $commentInFile) {
            if (isset($comment)) {
                if (!isset($arr[$commentInArr])) {
                    $arr[$commentInArr] = array();
                }
                $comment["When"] = strtotime($comment["When"]);
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
                if (count($x)>=2 && in_array($x[0], $normalHeaders)) {
                        $arr[$x[0]] = substr($singleLine, strlen($x[0])+1, strlen($singleLine)-strlen($x[0])); 
                }
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
                if (count($x)>=2 && in_array($x[0], $commentHeaders)) {
                        $comment[$x[0]] = substr($singleLine, strlen($x[0])+1, strlen($singleLine)-strlen($x[0])); 
                }
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
        $comment["When"] = strtotime($comment["When"]);
        array_push($arr[$commentInArr], $comment);
    }
    $arr["When"] = strtotime($arr["When"]);
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

//check field format
//check if session is OK
if (isset($_GET["fileid"]) && file_exists("teksty/".$_GET["fileid"].".txt")) {
//        $handle = @fopen("log", "a");
//        fwrite($handle, "wchodze");
//        fclose($handle);

    $template0 = readFileContent("templates/comment.txt");
    clearstatcache();
    $t = filemtime("teksty/".$_GET["fileid"].".txt");
    $arr = decodeFileContent(readFileContent("teksty/".$_GET["fileid"].".txt"), false);

    $num=0;
    if (isset($arr["Comments"])) { $num = count($arr["Comments"]);
    }

    echo "data:\n\n";
    ob_flush();
//            ob_end_flush();
    flush();

    while (true) {
        clearstatcache();
        if ($t != filemtime("teksty/".$_GET["fileid"].".txt")) {
//        $handle = @fopen("log", "a");
  //      fwrite($handle, "mamy update");
    //    fclose($handle);
            $arr = decodeFileContent(readFileContent("teksty/".$_GET["fileid"].".txt"), false);
            if (isset($arr["Comments"])) {
                for ($i=$num;$i<count($arr["Comments"]);$i++) {
                    $comment = $arr["Comments"][$i];
                    $template = $template0;
                    $template = str_replace_first("<!--USER-->", $comment["Author"], $template);
                    $template = str_replace_first("<!--TITLE-->", $comment["Title"], $template);
                    $template = str_replace_first("<!--WHEN-->", date("d M Y H:i:s", $comment["When"]), $template);
                    $template = str_replace_first("<!--TEXT-->", $comment["Text"], $template);
                    /*        $handle = @fopen("log", "a");
                    fwrite($handle, $template);
                    fclose($handle);
                    $handle = @fopen("log", "a");
                    fwrite($handle, "data: ".rawurlencode($template)."\n\n");
                    fclose($handle);*/
                    echo "data: ".rawurlencode($template)."\n\n";
                }
                $num = count($arr["Comments"]);
            }
            ob_flush();
//            ob_end_flush();
            flush();
            if (connection_aborted()==1) { break;
            }
            $t = filemtime("teksty/".$_GET["fileid"].".txt");
        }
        sleep(1);
    }
}

?>
