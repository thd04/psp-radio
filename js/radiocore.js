// ------------------------------------------------------------------------
// icecast.org の Stream Directory から放送局情報を取得し、放送局へ接続する
// サンプルプログラム（”XXX or Not” ラジオプレイヤーシリーズ専用）
//
// 注意：このプログラムコードは、常に正しく動作する事を保証するものではありません。
// ------------------------------------------------------------------------

if ( navigator.mimeTypes
     && navigator.mimeTypes ["application/x-psp-extplugin"] ) {
    var plugin
		= navigator.mimeTypes ["application/x-psp-extplugin"].enabledPlugin;
    if ( plugin ) {
        document.write
			("<object name=psp type=\"application/x-psp-extplugin\" >"
			 +"</object>\n");
    }
}
else psp = null;
var isPSPRadio = false;
window.onload = onLoadProc;
window.onunload = onUnLoadProc;

// ------------------------------------------------------------------------
// ページがロードされたときに行う処理
// ------------------------------------------------------------------------
function onLoadProc () {
	document.title = title; // タイトルを設定します。

    // document.write によって psp オブジェクトが作られるタイミング
    // （すなわち psp オブジェクトを参照可能になるタイミング）と
    // onLoadProc がコールされるタイミングは同期しないため、
    // psp オブジェクトへの参照処理を必要とする初期化処理は、
    // 意図的にディレイさせ、少し時差を以て処理を行う事にします。
    // そのためのタイマーをセットします。
	timerID_for_initProc = setTimeout (initProc, 1500);
}

// ------------------------------------------------------------------------
// ページがアンロードされたときに行う処理
// ------------------------------------------------------------------------
function onUnLoadProc () {} /* このプレイヤーでは何も処理しない。
							   別タブに何らかのページを開いたりしていた場合には、
							   この関数内にクローズ処理を記述する事で
							   ページを閉じる処理等を行う事ができます。*/

// タイマー ID 変数
var timerID_for_initProc = 0; // 初期化処理を少し遅らせるためのタイマー
var timerID_for_httpGetProc = 0; // http get 処理用タイマー
var timerID_for_streamStatusCheckProc = 0; // 音声ストリーム受信状態監視用タイマー

// icecast.org の Stream Directory へアクセスする WebAPI
var icecastStreamDirectoryUrl
	= "http://dir.xiph.org/search?start=0&num=50&search=";
var icecastM3uUrl = "http://dir.xiph.org";

var bAacpSupport = false; // AAC+ 再生が可能か否か
var bNowHttpGetIsBusy = false; // http get 処理中に true
var bInAnalizingStationListString = false; // 文字列パース中に true
var bForcedExitFlag = false; // 文字列パース処理を中断させるためのフラグ

var streamStatusCheckProcWorkState = 0; // チューニング音演出のためのステート値

var maxNumStation = 40; // 放送局リストの最大長
var numStationList = 0; // 放送局リストの長さ
var currentStation = 0; // 受信中の放送局

// ユーザーエージェント名（ストリーム受信用、http get 用、M3U 取得用）
var userAgentForPlayStream = "PSP-InternetRadioPlayer-Sample/1.00";
var userAgentForHttpGet = userAgentForPlayStream;
var userAgentForGetM3u = userAgentForPlayStream;

var stationArray = new Array (0); // 放送局リストの初期値（空の配列）

// ------------------------------------------------------------------------
// 初期化関数
// ------------------------------------------------------------------------
function initProc () {
	// タイマー ID リソースの解放
	clearTimeout (timerID_for_initProc); timerID_for_initProc = 0;
	// 音声ストリーム受信状態監視用タイマーを設定します。
	timerID_for_streamStatusCheckProc
		= setTimeout ('streamStatusCheckProc ()', 1500);
	if ( psp ) {
		psp.sysRadioBackLightAlwaysOn (1); // LCD バックライトを常時点灯させます。
		isPSPRadio = true; /* ここまで処理された事を以て、
							  インターネットラジオプレイヤーとして起動された
							  インターネットブラウザ上で動作していると認識します。*/
		psp.sysRadioSetDebugMode (0); // デバッグモード OFF
		psp.sysRadioSetSubVolume (0); // サブボリュームは最小にしておきます。
		psp.sysRadioSetMasterVolume (255); // メインボリュームは最大にしておきます。

		// AAC+ が再生が可能か否かの判定（PSP-1000 では false、PSP-2000 では true）
		bAacpSupport = psp.sysRadioCapabilityCheck (0) ? true : false;

		// 最初に鳴らす放送のジャンル名（検索文字列）は、OFF 側の配列から乱数で決定します。
		var n = offKeywords.length;
		var m = Math.floor (Math.random () * (n + 1));
		if ( n <= m ) m = n - 1;
		// 放送局リスト取得の準備を行います。
		prepareForGetStationList (offKeywords [m]);
	}
}

// ------------------------------------------------------------------------
// スイッチ操作があったときにコールされる関数
// 注）コール元の記述は index.html 内にあります。
// ------------------------------------------------------------------------
var switchState = false; // スイッチの ON/OFF 状態を保持する変数
function sw ( mode ) {
	switch ( mode ) {
	case 2: // onMouseDown
		if ( bNowHttpGetIsBusy ) return; // http get 処理中は無効
		// 文字列パース処理中のときは、その処理を中断させます。
		if ( bInAnalizingStationListString ) bForcedExitFlag = true;
		if ( isPSPRadio )
			psp.sysRadioPlayEffectSound (); // 音演出のため、クック音を鳴らします。
		switchState = !switchState; // スイッチのステートを反転させます。
		if ( switchState ) { // ON になるとき
			document.toggleSwitch.src = "images/on.gif"; // 絵の差し替え
			// "ON" 用配列からキーワードを一つチョイスします。
			// 注）properties.js に記述された "ON" 用配列は、要素数が１つないので
			// 　　常に同じものが選ばれますが、要素数が２以上のケースに対応するために
			// 　　"OFF" 時と同等の処理を行います。
			var n = onKeywords.length;
			var m = Math.floor (Math.random () * (n + 1));
			if ( n <= m ) m = n - 1;
			// 放送局リスト取得の準備を行います。
			prepareForGetStationList (onKeywords [m]);
		}
		else { // OFF になるとき
			document.toggleSwitch.src = "images/off.gif"; // 絵の差し替え
			var n = offKeywords.length;
			// "OFF" 用配列からキーワードを一つチョイスします。
			var m = Math.floor (Math.random () * (n + 1));
			if ( n <= m ) m = n - 1;
			// 放送局リスト取得の準備を行います。
			prepareForGetStationList (offKeywords [m]);
		}
		streamStatusCheckProcWorkState = 0; // ステートをリセット
		// 「チューニングしている状態」を表現するための音の演出
		if ( Math.random () < 0.5 ) psp.sysRadioSetAudioShiftWidth (-25);
		else psp.sysRadioSetAudioShiftWidth (15);
		break;
	default:
		break;
	}
}

// ------------------------------------------------------------------------
// icecast.org の Stream Directory から放送局リストを取得する準備を行う関数
// ------------------------------------------------------------------------
function prepareForGetStationList ( keyword ) {
	if ( ! isPSPRadio ) return;
	psp.sysRadioBusyIndicator (1); // ビジーアイコン表示を ON にします。
	// icecast.org の Stream Directory のキーワード検索 WebAPI を組み立てます。
	var url = icecastStreamDirectoryUrl + escape (keyword);
	var size = 49152; // 取得データのサイズ設定（この値が最大値）
	// http get の準備と、バックグラウンドでの処理を開始します。
	psp.sysRadioPrepareForHttpGet (url, userAgentForHttpGet, size, 0);
	bNowHttpGetIsBusy = true; // http get 処理中を示すフラグを true にします。
	httpGetProc (); /* httpGetProc はタイマーでポーリングされる関数
					   初回だけはここからコールします。
					   その後 http get 処理が完了するまでは
					   自身でタイマーを仕掛けてコールし続けます。*/
}

// ------------------------------------------------------------------------
// http get の処理状態を監視する関数
// ------------------------------------------------------------------------
function httpGetProc () {
	// タイマーリソースを一旦解放します。
	if ( 0 < timerID_for_httpGetProc ) {
		clearTimeout (timerID_for_httpGetProc);
		timerID_for_httpGetProc = 0;
	}
	// http get 処理が完了している場合は return します。
	if ( ! bNowHttpGetIsBusy ) return;
	if ( ! isPSPRadio ) return;
	result = psp.sysRadioGetHttpGetStatus (); // http get の処理状態を取得
	if ( result == 1 ) { // 処理中の場合
		// 自身を呼び出すタイマーを仕掛けて return します。
		timerID_for_httpGetProc	= setTimeout ('httpGetProc ()', 500);
		return;
	}
	else if ( result == -1 ) { // エラーが発生した場合
		bNowHttpGetIsBusy = false; // http get 中を示すフラグをリセットします。
		return; // エラーが発生した場合は return します。
	}
	// http get した結果を取り出します。
	var stationListStr = psp.sysRadioGetHttpGetResult ();
	// http get 処理が終わったので、内部リソースを解放するメソッドをコールします。
	psp.sysRadioHttpGetTerminate ();
	bNowHttpGetIsBusy = false; // http get 中を示すフラグをリセット。
	delete stationArray; // 放送局リスト配列を一旦解放します。
	// http get した文字列を解析し配列（放送局リスト）を作ります。
	stationArray = makeStationList (stationListStr);
	// 放送局リストの数の上限をクリップする処理を行います（実質的な意味はありません）。
	var n = stationArray.length;
	if ( maxNumStation < n ) {
		n = maxNumStation;
		stationArray = stationArray.slice (0, maxNumStation);
	}
	numStationList = n; // 放送局リストの数
	if ( numStationList == 0 ) { // 取得に失敗した場合
		if ( bForcedExitFlag == false ) { // かつ、強制中断でない場合
			// この状況は、選択されたジャンルに該当する放送局が存在しない事を意味します。
			// 音演出として、疑似ホワイトノイズを発生させます。
			psp.sysRadioSetWhiteNoiseOscillatorVolume (80);
			// サブボリュームは最小値にセットします。
			psp.sysRadioSetSubVolume (0);
			// クロスフェード中の状況を考慮して、その再生を停止させます。
			psp.sysRadioStop ();
			// ビジーアイコン表示を OFF にします。
			psp.sysRadioBusyIndicator (0);
		}
		currentStation = 0; // 変数のリセット
		return;
	}
	// 放送局リストの生成に成功した場合。
	bForcedExitFlag = false; // フラグのリセット
	// 取得した放送局リストの中からランダムに１つの放送局を選定します。
	currentStation = Math.floor (Math.random () * (numStationList + 1));
	if ( numStationList <= currentStation )
		currentStation = numStationList - 1;
	// 選ばれた放送局に接続し受信を開始します。
	tune (currentStation);
	// ビジーアイコン表示を OFF にします。
	psp.sysRadioBusyIndicator (0);
}

// ------------------------------------------------------------------------
// 受信開始関数
// 注）放送局リストの stationNumber で指定された放送局に接続し受信を開始します。
// ------------------------------------------------------------------------
function tune ( stationNumber ) {
	if ( numStationList == 0 ) return; // 放送局リストが空の場合は return します。
	if ( numStationList <= stationNumber ) return; // 範囲外の場合も return します。
	psp.sysRadioBusyIndicator (1); // ビジーアイコン表示を ON にします。
	// M3U データにアクセスするための URL を組み立てます。
	var m3uURL = icecastM3uUrl + stationArray [stationNumber].m3u;
	// M3U データの URL を指定し、放送の受信を開始します。
	psp.sysRadioPlayM3u
		(m3uURL, userAgentForGetM3u, userAgentForPlayStream);
}

// ------------------------------------------------------------------------
// 音声ストリーム受信状態監視用関数
// 注）タイマーによって、ある一定の時間間隔で処理が行われます。
// ------------------------------------------------------------------------
function streamStatusCheckProc () {
	// タイマーリソースを一旦解放します。
	if ( 0 < timerID_for_streamStatusCheckProc ) {
		clearTimeout (timerID_for_streamStatusCheckProc);
		timerID_for_streamStatusCheckProc = 0;
	}
	/* "PSP" インターネットラジオプレイヤーとして動作していない場合は
	   タイマーをセットしなおして return します。
	   注）一般的なブラウザ等による、おおまかな JavaScript の動作検証（デバッグ）を
	   　　行う等のケースを除き、このようなケースを考慮する必要はありません。*/
	if ( ! isPSPRadio ) {
		timerID_for_streamStatusCheckProc
			= setTimeout ('streamStatusCheckProc ()', 1500);
		return;
	}
	// 放送局リストが空の場合は、長めの時間にタイマーをセットしなおして return します。
	if ( numStationList == 0 ) {
		timerID_for_streamStatusCheckProc
			= setTimeout ('streamStatusCheckProc ()', 4000);
		return;
	}
	switch ( streamStatusCheckProcWorkState ) {
	case 0: // 最初のステート。これは音の演出のための時間を稼ぐためのものです。
		{
			// プレイヤーシステムコアの再生状態（内部の状態）値を取得します。
			var result = psp.sysRadioGetPlayerStatus ();
			switch ( result ) {
			case -1: // エラー
			case 1: // 再生中
			case 4: // 放送サーバーへ接続中
			case 0: // 処理中でない
				streamStatusCheckProcWorkState = 1; // 次のステートへ移行
				break;
			case 2: // M3U データを取得中
			case 3: // M3U データを解析中
			default:
				break;
			}
		}
		break;
	case 1:
		/* http get がバックグラウンドで処理中でなく、
		   かつ文字列のパース処理中でない場合には... */
		if ( ! bNowHttpGetIsBusy && ! bInAnalizingStationListString ) {
			// 次のステートへ移行させます（音の演出時間を十分に作るために設けたステート）。
			streamStatusCheckProcWorkState = 2;
		}
		break;
	case 2: // 最終的にはこのステートで再生状態を監視し続けます。
	default:
		psp.sysRadioSetAudioShiftWidth (0); // 音の演出を終えます。
		psp.sysRadioSetSubVolume (255); // サブボリュームを最大値にします。
		{
			// プレイヤーシステムコアの再生状態（内部の状態）値を取得します。
			var result = psp.sysRadioGetPlayerStatus ();
			switch ( result ) {
			case 0: // 処理中でない
				break;
			case -1: // エラー
				// 放送局リスト上の次の放送局へ切り替えます。
				if ( numStationList )
					currentStation = (currentStation + 1) % numStationList;
				// 放送局に接続し受信を開始します。
				tune (currentStation);
				break;
			case 1: // 再生中
			default:
				// クロスフェード逆側のストリームを強制的に停止させます。
				psp.sysRadioStop (1);
				// ビジーアイコン表示を OFF にします。
				psp.sysRadioBusyIndicator (0);
				// 疑似ホワイトノイズを停止させます。
				psp.sysRadioSetWhiteNoiseOscillatorVolume (0);
				break;
			}
		}
		break;
	}
	// 自身を呼び出すタイマーを仕掛けて return します。
	timerID_for_streamStatusCheckProc
	  = setTimeout ('streamStatusCheckProc ()', 1500);
}

// ------------------------------------------------------------------------
// icecast.org の Stream Directory Web ページの html を文字列としてパースし
// 放送局の配列（リスト）を作成します。
// ------------------------------------------------------------------------
// 文字列をパースするための検索キーワード群
var keyword_begin = "<table class=\"servers-list\">";
var keyword_beginStationRec = "<p class=\"stream-name\">";
var keyword_preRefPage = "<span class=\"name\"><a href=\"";
var keyword_preRefPageB = "<span class=\"name\"";
var keyword_postRefPage = "\"";
var keyword_preStationName = ">";
var keyword_postStationName = "</a></span>";
var keyword_postStationNameB = "</span>";
var keyword_preListeners = "<span class=\"listeners\">[";
var keyword_postListeners = "&nbsp;listener";
var keyword_preComment = "<p class=\"stream-description\">";
var keyword_postComment = "</p>";
var keyword_preM3uUrl = "<p>[ <a href=\"";
var keyword_postM3uUrl = "\" title=\"";
var keyword_preBitrate = "<p class=\"format\"";
var keyword_postBitrateA = ">";
var keyword_postBitrateB = " title=\"";
var keyword_postBitrateB2 = "\">"; 
var keyword_protocol_MP3 = "MP3";
var keyword_protocol_AACP = "AAC+";
var keyword_endStationRec = "</tr>";
function makeStationList ( stationListString ) {
    stationRec = new Object (); // 作業用オブジェクト
    var currentPos = 0; // 文字列の処理位置ポインタ
    var startPos = 0; // 作業用文字位置ポインタ
    var endPos = 0; // 作業用文字位置ポインタ
    var stationRecEnd = 0;
    var prevCurrentPos = -1; // 作業用文字位置ポインタ
    var state = 0; // 解析キーワード判別用ステート変数
    var count = 0; // リストサイズ（個数）カウンタ
    psp.sysRadioPrepareForStrOperation (stationListString); // 文字列処理の準備
    var length = psp.sysRadioStrLength (); // 文字列の長さ
    var bExit = false;
    var bNoRefPage = false;
    var stationList = new Array (0); // リターン値として返す配列の初期化
    bInAnalizingStationListString = true; // 文字列のパース処理中には true に
    // 文字列の最後に達するか、強制中断が発生するまで繰り返す
    while ( bExit == false && bForcedExitFlag == false ) {
        switch ( state ) {
        case 0: // 先頭部分をスキップ（この処理はパース開始時に一度だけ行います）
            currentPos = psp.sysRadioStrIndexOf (keyword_begin, currentPos);
            state = 1;
            break;
        case 1: // 関連ページ URL
            // ここで放送局の情報を一時的に格納する変数を初期化します。
            bNoRefPage = false;
            stationRec.rp = stationRec.name = stationRec.lc = stationRec.comment
                = stationRec.m3u = stationRec.br = "";
            stationRec.protocol = "M";
            startPos
                = stationListString.indexOf (keyword_beginStationRec, currentPos);
            if ( startPos < 0 ) { bExit = true; break; }
            stationRecEnd
                = psp.sysRadioStrIndexOf (keyword_endStationRec, currentPos);
            startPos
                = psp.sysRadioStrIndexOf (keyword_preRefPage, currentPos);
            if ( startPos < stationRecEnd ) {
                startPos += keyword_preRefPage.length;
                endPos = psp.sysRadioStrIndexOf (keyword_postRefPage, startPos);
                stationRec.rp = psp.sysRadioStrSlice (startPos, endPos);
                currentPos = endPos + keyword_postRefPage.length;
            }
            else {
                startPos
                    = psp.sysRadioStrIndexOf (keyword_preRefPageB, currentPos);
                if ( 0 <= startPos ) currentPos = startPos + keyword_preRefPageB.length;
                bNoRefPage = true;
            }
            ++state;
            break;
        case 2: // 放送局名
            startPos
                = psp.sysRadioStrIndexOf
                (keyword_preStationName, currentPos);
            if ( startPos < 0 ) {
                bExit = true;
                break;
            }
            startPos += keyword_preStationName.length;
            if ( bNoRefPage ) {
                endPos
                    = psp.sysRadioStrIndexOf
                    (keyword_postStationNameB, startPos);
                stationRec.name = psp.sysRadioStrSlice (startPos, endPos);
                currentPos = endPos + keyword_postStationNameB.length;
            }
            else {
                endPos
                    = psp.sysRadioStrIndexOf
                    (keyword_postStationName, startPos);
                stationRec.name = psp.sysRadioStrSlice (startPos, endPos);
                currentPos = endPos + keyword_postStationName.length;
            }
            ++state;
            break;
        case 3: // リスナーカウント
            startPos
                = psp.sysRadioStrIndexOf
                (keyword_preListeners, currentPos);
            if ( startPos < 0 || currentPos == startPos ) {
                bExit = true;
                break;
            }
            startPos += keyword_preListeners.length;
            endPos
                = psp.sysRadioStrIndexOf
                (keyword_postListeners, startPos);
            stationRec.lc = psp.sysRadioStrSlice (startPos, endPos);
            currentPos = endPos + keyword_postListeners.length;
            ++state;
            break;
        case 4: // コメント
            startPos
                = psp.sysRadioStrIndexOf
                (keyword_preComment, currentPos);
            if ( startPos < 0 || currentPos == startPos ) {
                bExit = true;
                break;
            }
            startPos += keyword_preComment.length;
            endPos
                = psp.sysRadioStrIndexOf
                (keyword_postComment, startPos);
            stationRec.comment = stationListString.slice (startPos, endPos);
            currentPos = endPos + keyword_postComment.length;
            ++state;
            break;
        case 5: // M3U URL
            startPos
                = psp.sysRadioStrIndexOf
                (keyword_preM3uUrl, currentPos);
            if ( startPos < 0 || currentPos == startPos ) {
                bExit = true;
                break;
            }
            startPos += keyword_preM3uUrl.length;
            endPos
                = psp.sysRadioStrIndexOf
                (keyword_postM3uUrl, startPos);
            stationRec.m3u = psp.sysRadioStrSlice (startPos, endPos);
            currentPos = endPos + keyword_postM3uUrl.length;
            ++state;
            break;
        case 6: // ビットレート
            startPos
                = psp.sysRadioStrIndexOf
                (keyword_preBitrate, currentPos);
            if ( startPos < 0 || currentPos == startPos ) {
                bExit = true;
                break;
            }
            startPos += keyword_preBitrate.length;
            var endPosA
                = psp.sysRadioStrIndexOf
                (keyword_postBitrateA, startPos);
            var endPosB
                = psp.sysRadioStrIndexOf
                (keyword_postBitrateB, startPos);
            if ( endPosA < endPosB )
                currentPos = endPosA + keyword_postBitrateA.length;
            else {
                startPos += keyword_postBitrateB.length;
                endPos
                    = psp.sysRadioStrIndexOf
                    (keyword_postBitrateB2, startPos);
                stationRec.br = psp.sysRadioStrSlice (startPos, endPos);
                currentPos = endPos + keyword_postBitrateB2.length;
            }
            ++state;
            break;
        case 7: // プロトコル
            var protocol_MP3
                = psp.sysRadioStrIndexOf
                (keyword_protocol_MP3, currentPos);
            var protocol_AACP
                = psp.sysRadioStrIndexOf
                (keyword_protocol_AACP, currentPos);
            if ( 0 <= protocol_MP3 && protocol_MP3 < stationRecEnd )
                stationRec.protocol = "M";
            else if ( 0 <= protocol_AACP && protocol_AACP < stationRecEnd )
                stationRec.protocol = "A";
            else stationRec.protocol = "O";
            currentPos = stationRecEnd + keyword_endStationRec.length;
            if ( ( currentPos < prevCurrentPos )
                 || ( prevCurrentPos == currentPos )
                 || ( length - 1 <= currentPos ) ) {
                bExit = true;
            }
            else {
                if ( ( bAacpSupport && stationRec.protocol == "A" )
                     || stationRec.protocol == "M" ) {
                    // 切り出した一つの放送局情報を配列に追加
                    /* 注）このラジオプレイヤーでは使用しない情報も、
                       とりあえず配列に取り込んでおきます。*/
                    stationList.push
                        ({stationName: stationRec.name,
                               comment: stationRec.comment,
                                     br: stationRec.br,
                                    m3u: stationRec.m3u,
                                   aacp: (stationRec.protocol == "A")
                                          ? true : false,
                               refPage: stationRec.rp,
                             streamUrl: ""
                                });
                    ++count; // カウンタをインクリメント
                    if ( maxNumStation <= count ) bExit = true; // 上限チェック
                }
            }
            prevCurrentPos = currentPos;
            state = 1; // 次の放送局情報の切り出し準備。ステート 1 から繰り返します。
            break;
        }
    }
    psp.sysRadioStrOperationTerminate (); // 文字列処理を終わります。
    // 強制中断された場合は、作成した配列を一旦破棄し、空の配列にして返します。
    if ( bForcedExitFlag ) {
        delete stationList;
        stationList = new Array (0);
    }
    bInAnalizingStationListString = false; // 文字列のパース処理中には false に。
    delete stationRec; // 作業用オブジェクトを解放します。
    return ( stationList );
}

/*
  Local Variables:
  tab-width:4
  End:
*/
