
var janus = null;
var streaming = null;
var opaqueId = "streamingtest-"+Janus.randomString(12);

var bitrateTimer = null;
var selectedStream = null;


$(document).ready(function() {
	// Initialize the library (all console debuggers enabled)
	Janus.init({debug: "all", callback: function() {
			// Make sure the browser supports WebRTC
			if(!Janus.isWebrtcSupported()) {
				alert("No WebRTC support... ");
				return;
			}
			// Create session
			janus = new Janus(
				{
					server: "http://192.168.1.100:8088/janus",   //enter your janus gateway IP address
					success: function() {
						// Attach to streaming plugin
						janus.attach(
							{
								plugin: "janus.plugin.streaming",
								opaqueId: opaqueId,
								success: function(pluginHandle) {
									$('#watch').html("Watch").click(startStream);
									streaming = pluginHandle;
									Janus.log("Plugin attached! (" + streaming.getPlugin() + ", id=" + streaming.getId() + ")");
									//get available streams and select the one we need
									updateStreamsList();
								},
								error: function(error) {
									Janus.error("  -- Error attaching plugin... ", error);
									alert("Error attaching plugin... " + error);
								},
								onmessage: function(msg, jsep) {
									Janus.debug(" ::: Got a message :::");
									Janus.debug(msg);
									var result = msg["result"];
									if(result !== null && result !== undefined) {
										if(result["status"] !== undefined && result["status"] !== null) {
											var status = result["status"];
											if(status === 'starting')
												Janus.log("Starting, please wait...");
											else if(status === 'started')
												Janus.log("Started");
											else if(status === 'stopped')
												stopStream();
										}
									} else if(msg["error"] !== undefined && msg["error"] !== null) {
										alert(msg["error"]);
										stopStream();
										return;
									}
									if(jsep !== undefined && jsep !== null) {
										Janus.debug("Handling SDP as well...");
										Janus.debug(jsep);
										// Offer from the plugin, let's answer
										streaming.createAnswer(
											{
												jsep: jsep,
												media: { audioSend: false, videoSend: false },	// We want recvonly audio/video
												success: function(jsep) {
													Janus.debug("Got SDP!");
													Janus.debug(jsep);
													var body = { "request": "start" };
													streaming.send({"message": body, "jsep": jsep});
													$('#watch').html("Stop").click(stopStream);
												},
												error: function(error) {
													Janus.error("WebRTC error:", error);
													alert("WebRTC error... " + JSON.stringify(error));
												}
											});
									}
								},
								onremotestream: function(stream) {
									Janus.debug(" ::: Got a remote stream :::");
									Janus.debug(stream);
									if($('#remotevideo').length === 0) {
										$('#stream').append('<video class="rounded centered" id="remotevideo" width=640 height=480 autoplay/>');
										// Show the stream and hide the spinner when we get a playing event
										$("#remotevideo").on("playing", function () {
											Janus.log("playng");
											var videoTracks = stream.getVideoTracks();
											if(videoTracks === null || videoTracks === undefined || videoTracks.length === 0){
												alert("no videotraks ?!?");
												return;
											}
										});
									}
									Janus.attachMediaStream($('#remotevideo').get(0), stream);
									var videoTracks = stream.getVideoTracks();
									if(videoTracks === null || videoTracks === undefined || videoTracks.length === 0) {
										// No remote video
										alert("No remote video available!");
									}
									if(videoTracks && videoTracks.length &&
											(Janus.webRTCAdapter.browserDetails.browser === "chrome" ||
												Janus.webRTCAdapter.browserDetails.browser === "firefox" ||
												Janus.webRTCAdapter.browserDetails.browser === "safari")) {
												bitrateTimer = setInterval(function() {
													Janus.debug("Current bitrate is " + streaming.getBitrate());
												}, 1000);
												}
								},
								oncleanup: function() {
									Janus.log(" ::: Got a cleanup notification :::");
									alert("streaming cleanup");
									$('#remotevideo').remove();
									if(bitrateTimer !== null && bitrateTimer !== undefined)
										clearInterval(bitrateTimer);
									bitrateTimer = null;
									$('#watch').html("Watch").click(startStream);
								}
							});
					},
					error: function(error) {
						Janus.error(error);
						alert(error, function() {
							window.location.reload();
						});
					},
					destroyed: function() {
						window.location.reload();
					}
				});
	}});
});

function updateStreamsList() {
	var body = { "request": "list" };
	Janus.debug("Sending message (" + JSON.stringify(body) + ")");
	streaming.send({"message": body, success: function(result) {
		if(result === null || result === undefined) {
			alert("Got no response to our query for available streams");
			return;
		}
		if(result["list"] !== undefined && result["list"] !== null) {
			var list = result["list"];
			Janus.log("Got a list of available streams");
			Janus.debug(list);
			for(var mp in list) {
				Janus.debug("  >> [" + list[mp]["id"] + "] " + list[mp]["description"] + " (" + list[mp]["type"] + ")");
			}
			selectedStream = list[0]["id"];
		}
	}});
}

function startStream() {
	$('#watch').off();
	Janus.log("Selected video id #" + selectedStream);
	if(selectedStream === undefined || selectedStream === null) {
		alert("unselected stream");
		return;
	}
	var body = { "request": "watch", id: parseInt(selectedStream) };
	streaming.send({"message": body});
	// No remote video yet
	Janus.log("starting stream");
}

function stopStream() {
	$('#watch').off();
	var body = { "request": "stop" };
	streaming.send({"message": body});
	streaming.hangup();
	if(bitrateTimer !== null && bitrateTimer !== undefined)
		clearInterval(bitrateTimer);
	bitrateTimer = null;
}