'use strict';

const AWS = require('aws-sdk');
const url = require('url');
const https = require('https');
const querystring = require('querystring');

const encrypted = {
	slackTeamID: process.env.slackTeamID,
	slackDomain: process.env.slackDomain,
	slackChannelID: process.env.slackChannelID,
	slackChannelName: process.env.slackChannelName,
	slackToken: process.env.slackToken,
	sdpToken: process.env.sdpToken

};

let decrypted = {};


function postMessage(message, response_url, callback) {
    const body = JSON.stringify(message);
    const options = url.parse(response_url);
    options.method = 'POST';
    options.headers = {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
    };

    const postReq = https.request(options, (res) => {
        const chunks = [];
        res.setEncoding('utf8');
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
            if (callback) {
                callback({
                    body: chunks.join(''),
                    statusCode: res.statusCode,
                    statusMessage: res.statusMessage,
                });
            }
        });
        return res;
    });

    postReq.write(body);
    postReq.end();
}

function createSlackMessage(event, slackUpdate, actions, color, callback) {

    const slackMessage = {
	"team":{
		"id": decrypted.slackTeamID,
		"domain": decrypted.slackDomain
	},
	"channel":{
		"id": decrypted.slackChannelID,
		"name": decrypted.slackChannelName
	},
	"text" : event.original_message.text,
    "attachments": event.original_message.attachments
};

    slackMessage.attachments[0] = {
                "title": "Event",
                "text": slackMessage.attachments[0].text + "\n" + slackUpdate,
                "fallback": "loggly alert",
                "callback_id": event.callback_id,
                "color": color,
                "attachment_type": "default",
                "actions": actions
            };

    postMessage(slackMessage, event.response_url, (response) => {
        if (response.statusCode < 400) {
            console.info('Message posted successfully');

        } else if (response.statusCode < 500) {
            console.error(`Error posting message to Slack API: ${response.statusCode} - ${response.statusMessage}`);
            callback(null);  // Don't retry because the error is due to a problem with the request
        } else {
            // Let Lambda retry
            callback(`Server error when processing message: ${response.statusCode} - ${response.statusMessage}`);
        }
    });
}

function createSDPTicket(event, slackRes, callback){

	console.log("send SDP to update ticket");

	const body = "";
	var INPUT_DATA = {
		   "operation": {
		      "Details": {
		         "REQUESTER": slackRes.user.profile.real_name,
		         "SUBJECT": event.callback_id + " created in Slack by user " + event.user.name,
		         "REQUESTTEMPLATE": "Default Request",
		         "PRIORITY": "02-Normal",
				 "GROUP": event.actions[0].selected_options[0].value,
		         "LEVEL": "Tier 1",
		         "DESCRIPTION": event.original_message.attachments[0].text,
		         "REQUESTEREMAIL": slackRes.user.profile.email
		       }
		   }
		};

	INPUT_DATA = JSON.stringify(INPUT_DATA);
	INPUT_DATA = querystring.escape(INPUT_DATA);

	const path = '/api/json/request?authtoken=' + decrypted.sdpToken + '&scope=sdpodapi&OPERATION_NAME=ADD_REQUEST&INPUT_DATA=' + INPUT_DATA;

	var post_options = {
			host: 'sdpondemand.manageengine.com',
			port: '443',
			path: path,
			method: 'POST',
			headers: {
					'Content-Type': 'application/x-www-form-urlencoded'
			}
	};

	const postReq = https.request(post_options, (res) => {
			const chunks = [];
			res.setEncoding('utf8');
			res.on('data', (chunk) => chunks.push(chunk));
			res.on('end', () => {
					if (callback) {
							callback({
									body: chunks.join(''),
									statusCode: res.statusCode,
									statusMessage: res.statusMessage,
							});
					}
			});
			return res;
	});

	postReq.write(body);
	postReq.end();

}

function getSlackUserEmail(event, callback) {
	  const body = "";

		const path = '/api/users.info?token=' + decrypted.slackToken + '&user=' + event.user.id ;

		var post_options = {
				host: 'slack.com',
				port: '443',
				path: path,
				method: 'POST',
				headers: {
						'Content-Type': 'application/x-www-form-urlencoded'
				}
		};

	const postReq = https.request(post_options, (res) => {
			const chunks = [];
			res.setEncoding('utf8');
			res.on('data', (chunk) => chunks.push(chunk));
			res.on('end', () => {
					if (callback) {
							callback({
									body: chunks.join(''),
									statusCode: res.statusCode,
									statusMessage: res.statusMessage,
							});
					}
			});
			return res;
	});

	postReq.write(body);
	postReq.end();

}

function processEvent(event, callback) {
    var eventTime = new Date();
    var options = {};
    options.timeZone = 'America/Chicago';

	if (event.actions[0].name === "sdp") {

		getSlackUserEmail(event, (cb) => {
			if (cb.statusCode < 400) {
					var slackRes = JSON.parse(cb.body);

            		createSDPTicket(event, slackRes, (response) => {
                    if (response.statusCode < 400) {
                        console.info('SDP Message posted successfully');
                        var sdpResult = JSON.parse(response.body);
                        slackUpdate = ":white_check_mark: <@" + event.user.id + "> created SDP ticket #" + sdpResult.operation.Details.WORKORDERID + " at " + eventTime.toLocaleString('en-US', options) + " (CST)\nhttps://outsell.sdpondemand.manageengine.com/app/itdesk/WorkOrder.do?woMode=viewWO&woID=" + sdpResult.operation.Details.LONG_REQUESTID;
												var actions = [
													{
														"name": "resolved",
														"text": "Resolved",
														"type": "button",
														"value": "resolved"
													}
												];
                        createSlackMessage(event, slackUpdate, actions, "warning");

                        //callback(null);
                    } else if (response.statusCode < 500) {
                        console.error(`Error posting message to SDP API: ${response.statusCode} - ${response.statusMessage}`);
                        callback(null);  // Don't retry because the error is due to a problem with the request
                        var slackUpdate = ":warning: Error creating SDP ticket";
												var actions = "";
                        createSlackMessage(event, slackUpdate, actions, "danger");
                    } else {
                        // Let Lambda retry
                        callback(`Server error when processing message: ${response.statusCode} - ${response.statusMessage}`);
                    }
                });



			} else if (cb.statusCode < 500) {
				console.error(`Error getting Slack user email: ${cb.statusCode} - ${cb.statusMessage}`);
				callback(null);
			} else {
				callback(`Server error when processing message: ${cb.statusCode} - ${cb.statusMessage}`);
			}
		});

	}else if (event.actions[0].name === "acknowledge"){
	 	var slackUpdate = ":white_check_mark: <@" + event.user.id + "> acknowledged the alert at " + eventTime.toLocaleString('en-US', options) + " (CST)";
		var actions = [
			{
				"name": "sdp",
				"text": "Create SDP Ticket...",
				"type": "select",
				"options":[
					{
						"text": "CSI Support",
						"value": "CSI Support Team"
					},
					{
						"text": "Infrastructure",
						"value": "Infrastructure"
					},
					{
						"text": "Help Desk",
						"value": "Help Desk"
					}
				]
			},
			{
				"name": "resolved",
				"text": "Resolved",
				"type": "button",
				"value": "resolved"
			}
	];
		createSlackMessage(event, slackUpdate, actions, "warning");
	} else if (event.actions[0].name === "resolved"){
		var slackUpdate = ":ok_check: <@" + event.user.id + "> marked the alert as resolved at " + eventTime.toLocaleString('en-US', options) + " (CST)";
		var actions = "";
		createSlackMessage(event, slackUpdate, actions, "good");
	}
}


exports.handler = (event, context, callback) => {

	if ( decrypted.slackTeamID && decrypted.slackDomain && decrypted.slackChannelID && decrypted.slackChannelName && decrypted.slackToken && decrypted.sdpToken) {
			processEvent(event, callback);
	} else {
			const kms = new AWS.KMS();

			const decryptPromises = [
					kms.decrypt( { CiphertextBlob: new Buffer(encrypted.slackTeamID, 'base64') } ).promise(),
					kms.decrypt( { CiphertextBlob: new Buffer(encrypted.slackDomain, 'base64') } ).promise(),
					kms.decrypt( { CiphertextBlob: new Buffer(encrypted.slackChannelID, 'base64') } ).promise(),
					kms.decrypt( { CiphertextBlob: new Buffer(encrypted.slackChannelName, 'base64') } ).promise(),
					kms.decrypt( { CiphertextBlob: new Buffer(encrypted.slackToken, 'base64') } ).promise(),
					kms.decrypt( { CiphertextBlob: new Buffer(encrypted.sdpToken, 'base64') } ).promise()
			];

			Promise.all( decryptPromises ).then( data => {
					decrypted.slackTeamID = data[0].Plaintext.toString('ascii');
					decrypted.slackDomain = data[1].Plaintext.toString('ascii');
					decrypted.slackChannelID = data[2].Plaintext.toString('ascii');
					decrypted.slackChannelName = data[3].Plaintext.toString('ascii');
					decrypted.slackToken = data[4].Plaintext.toString('ascii');
					decrypted.sdpToken = data[5].Plaintext.toString('ascii');

					processEvent(event, callback);
			}).catch( err => {
					console.log('Decrypt error:', err);
					return callback(err);
			});
	}
};
