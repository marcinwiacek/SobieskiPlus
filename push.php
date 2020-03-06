<?php
//session_write_close();
ignore_user_abort(false);
set_time_limit(60);//1 minute
header('Content-Type: text/event-stream');
header('Cache-Control: no-cache');

require "internal/shared.php";

//check field format
//check if session is OK
if (isset($_GET["fileid"]) && file_exists("teksty/".$_GET["fileid"].".txt")) {
    //        $handle = @fopen("log", "a");
    //        fwrite($handle, "wchodze");
    //        fclose($handle);

    $template0 = readFileContent("internal/comment.txt");
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
