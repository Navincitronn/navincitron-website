<?php
if ($_SERVER["REQUEST_METHOD"] == "POST") {
    $message = htmlspecialchars($_POST['message']);

    $to = "navincitronn@gmail.com";
    $subject = "New Album Isolation Recommendation";
    $headers = "From: no-reply@navincitron.com\r\n";
    $headers .= "Reply-To: no-reply@navincitron.com\r\n";
    $headers .= "Content-Type: text/plain; charset=UTF-8\r\n";

    mail($to, $subject, $message, $headers);

    header("Location: acknowledgement.html");
    exit();
} else {
    header("Location: contact.html");
    exit();
}
?>
