<?php

function strncmp_startswith($haystack, $needle)
{
    return strncmp($haystack, $needle, strlen($needle)) === 0;
}

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

?>
