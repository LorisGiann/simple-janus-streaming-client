// We make use of this 'server' variable to provide the address of the
// REST Janus API. By default, in this example we assume that Janus is
// co-located with the web server hosting the HTML pages but listening
// on a different port (8088, the default for HTTP in Janus), which is
// why we make use of the 'window.location.hostname' base address. Since
// Janus can also do HTTPS, and considering we don't really want to make
// use of HTTP for Janus if your demos are served on HTTPS, we also rely
// on the 'window.location.protocol' prefix to build the variable, in
// particular to also change the port used to contact Janus (8088 for
// HTTP and 8089 for HTTPS, if enabled).
// In case you place Janus behind an Apache frontend (as we did on the
// online demos at http://janus.conf.meetecho.com) you can just use a
// relative path for the variable, e.g.:
//
// 		var server = "/janus";
//
// which will take care of this on its own.
//
//
// If you want to use the WebSockets frontend to Janus, instead, you'll
// have to pass a different kind of address, e.g.:
//
// 		var server = "ws://" + window.location.hostname + ":8188";
//
// Of course this assumes that support for WebSockets has been built in
// when compiling the server. WebSockets support has not been tested
// as much as the REST API, so handle with care!
//
//
// If you have multiple options available, and want to let the library
// autodetect the best way to contact your server (or pool of servers),
// you can also pass an array of servers, e.g., to provide alternative
// means of access (e.g., try WebSockets first and, if that fails, fall
// back to plain HTTP) or just have failover servers:
//
//		var server = [
//			"ws://" + window.location.hostname + ":8188",
//			"/janus"
//		];
//
// This will tell the library to try connecting to each of the servers
// in the presented order. The first working server will be used for
// the whole session.
//
var server = null;
if(window.location.protocol === 'http:')
	server = "http://" + window.location.hostname + ":8088/janus";
else
	server = "https://" + window.location.hostname + ":8089/janus";

var janus = null;
var streaming = null;
var opaqueId = "streamingtest-"+Janus.randomString(12);

var bitrateTimer = null;
var spinner = null;
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
					server: server,
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
									$('#start').removeAttr('disabled').html("Stop")
										.click(function() {
											$(this).attr('disabled', true);
											clearInterval(bitrateTimer);
											janus.destroy();
											$('#streamslist').attr('disabled', true);
											$('#watch').attr('disabled', true).unbind('click');
											$('#start').attr('disabled', true).html("Bye").unbind('click');
										});
								},
								error: function(error) {
									Janus.error("  -- Error attaching plugin... ", error);
									alert("Error attaching plugin... " + error);
								},
								iceState: function(state) {
									Janus.log("ICE state changed to " + state);
								},
								webrtcState: function(on) {
									Janus.log("Janus says our WebRTC PeerConnection is " + (on ? "up" : "down") + " now");
								},
								onmessage: function(msg, jsep) {
									Janus.debug(" ::: Got a message :::", msg);
									var result = msg["result"];
									if(result) {
										if(result["status"]) {
											var status = result["status"];
											if(status === 'starting') {
												Janus.log("Starting, please wait...");
												$('#status').removeClass('hide').text("Starting, please wait...").show();
											}
											else if(status === 'started') {
												Janus.log("Started");
												$('#status').removeClass('hide').text("Started").show();
											}
											else if(status === 'stopped') {
												stopStream();
												$('#status').removeClass('hide').text("Stopped").show();
											}
										}
									} else if(msg["error"]) {
										alert(msg["error"]);
										stopStream();
										return;
									}
									if(jsep) {
										Janus.debug("Handling SDP as well...", jsep);
										var stereo = (jsep.sdp.indexOf("stereo=1") !== -1);
										// Offer from the plugin, let's answer
										streaming.createAnswer(
											{
												jsep: jsep,
												// We want recvonly audio/video and, if negotiated, datachannels
												media: { audioSend: false, videoSend: false, data: true },
												customizeSdp: function(jsep) {
													if(stereo && jsep.sdp.indexOf("stereo=1") == -1) {
														// Make sure that our offer contains stereo too
														jsep.sdp = jsep.sdp.replace("useinbandfec=1", "useinbandfec=1;stereo=1");
													}
												},
												success: function(jsep) {
													Janus.debug("Got SDP!", jsep);
													var body = { request: "start" };
													streaming.send({ message: body, jsep: jsep });
													$('#watch').html("Stop").removeAttr('disabled').click(stopStream);
												},
												error: function(error) {
													Janus.error("WebRTC error:", error);
													alert("WebRTC error... " + JSON.stringify(error));
												}
											});
									}
								},
								onremotestream: function(stream) {
									Janus.debug(" ::: Got a remote stream :::", stream);
									var addButtons = false;
									if($('#remotevideo').length === 0) {
										addButtons = true;
										$('#stream').append('<video class="rounded centered" id="remotevideo" width="100%" height="100%" playsinline/>');
										$('#remotevideo').get(0).volume = 0;
										// Show the stream and hide the spinner when we get a playing event
										$("#remotevideo").on("playing", function () {
											Janus.log("playng");
											if(spinner)
												spinner.stop();
											spinner = null;
											var videoTracks = stream.getVideoTracks();
											if(!videoTracks || videoTracks.length === 0){
												alert("no videotracks ?!?");
												return;
											}

											var width = this.videoWidth;
											var height = this.videoHeight;
											$('#curres').removeClass('hide').text(width+'x'+height).show();
											if(Janus.webRTCAdapter.browserDetails.browser === "firefox") {
												// Firefox Stable has a bug: width and height are not immediately available after a playing
												setTimeout(function() {
													var width = $("#remotevideo").get(0).videoWidth;
													var height = $("#remotevideo").get(0).videoHeight;
													$('#curres').removeClass('hide').text(width+'x'+height).show();
												}, 2000);
											}
										});
									}
									Janus.attachMediaStream($('#remotevideo').get(0), stream);
									$("#remotevideo").get(0).play();
									$("#remotevideo").get(0).volume = 1;
									var videoTracks = stream.getVideoTracks();
									if(!videoTracks || videoTracks.length === 0) {
										// No remote video
										alert("No remote video available!");
										$('#remotevideo').hide();
										if($('#stream .no-video-container').length === 0) {
											$('#stream').append(
												'<div class="no-video-container">' +
													'<i class="fa fa-video-camera fa-5 no-video-icon"></i>' +
													'<span class="no-video-text">No remote video available</span>' +
												'</div>');
										}
									} else {
										$('#stream .no-video-container').remove();
										$('#remotevideo').removeClass('hide').show();
									}
									if(!addButtons)
										return;
									if(videoTracks && videoTracks.length &&
											(Janus.webRTCAdapter.browserDetails.browser === "chrome" ||
												Janus.webRTCAdapter.browserDetails.browser === "firefox" ||
												Janus.webRTCAdapter.browserDetails.browser === "safari")) {
											$('#curbitrate').removeClass('hide').show();
											bitrateTimer = setInterval(function() {
												// Display updated bitrate, if supported
												var bitrate = streaming.getBitrate();
												$('#curbitrate').text(bitrate);
												// Check if the resolution changed too
												var width = $("#remotevideo").get(0).videoWidth;
												var height = $("#remotevideo").get(0).videoHeight;
												if(width > 0 && height > 0)
													$('#curres').removeClass('hide').text(width+'x'+height).show();

												Janus.debug("Current bitrate is " + bitrate);

											}, 1000);
									}
								},
								ondataopen: function(data) {
									Janus.log("The DataChannel is available!");
									$('#stream').append(
										'<input class="form-control" type="text" id="datarecv" disabled></input>'
									);
									if(spinner)
										spinner.stop();
									spinner = null;
								},
								ondata: function(data) {
									Janus.debug("We got data from the DataChannel!", data);
									$('#datarecv').val(data);
								},
								oncleanup: function() {
									Janus.log(" ::: Got a cleanup notification :::");
									$('#remotevideo').remove();
									$('#datarecv').remove();
									$('.no-video-container').remove();
									$('#curbitrate').hide();
									if(bitrateTimer)
										clearInterval(bitrateTimer);
									bitrateTimer = null;
									$('#curres').hide();
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
	var body = { request: "list" };
	Janus.debug("Sending message:", body);
	streaming.send({ message: body, success: function(result) {
		if(!result) {
			alert("Got no response to our query for available streams");
			return;
		}
		if(result["list"]) {
			$('#watch').attr('disabled', true).unbind('click');
			var list = result["list"];
			Janus.log("Got a list of available streams");
			if(list && Array.isArray(list)) {
				list.sort(function(a, b) {
					if(!a || a.id < (b ? b.id : 0))
						return -1;
					if(!b || b.id < (a ? a.id : 0))
						return 1;
					return 0;
				});
			}
			Janus.debug(list);
			for(var mp in list) {
				Janus.debug("  >> [" + list[mp]["id"] + "] " + list[mp]["description"] + " (" + list[mp]["type"] + ")");
			}
			selectedStream = list[0]["id"];

			$('#watch').removeAttr('disabled').unbind('click').click(startStream);
		}

	}});
}

function getStreamInfo() {
	$('#metadata').empty();
	$('#info').addClass('hide').hide();
	if(!selectedStream)
		return;
	// Send a request for more info on the mountpoint we subscribed to
	var body = { request: "info", id: parseInt(selectedStream) || selectedStream };
	streaming.send({ message: body, success: function(result) {
		if(result && result.info && result.info.metadata) {
			$('#metadata').html(result.info.metadata);
			$('#info').removeClass('hide').show();
		}
	}});
}

function startStream() {
	Janus.log("Selected video id #" + selectedStream);
	if(!selectedStream) {
		alert("unselected stream");
		return;
	}
	$('#watch').attr('disabled', true).unbind('click');
	var body = { request: "watch", id: parseInt(selectedStream) || selectedStream};
	streaming.send({ message: body });
	// No remote video yet
	Janus.log("Starting stream");

	if(spinner == null) {
		var target = document.getElementById('stream');
		spinner = new Spinner({top:100}).spin(target);
	} else {
		spinner.spin();
	}
	// Get some more info for the mountpoint to display, if any
	//getStreamInfo();
}

function stopStream() {
	$('#watch').attr('disabled', true).unbind('click');
	var body = { request: "stop" };
	streaming.send({ message: body });
	streaming.hangup();
	$('#watch').html("Watch").removeAttr('disabled').unbind('click').click(startStream);
	$('#status').empty().hide();
	$('#curbitrate').hide();
	if(bitrateTimer)
		clearInterval(bitrateTimer);
	bitrateTimer = null;
	$('#curres').empty().hide();
}