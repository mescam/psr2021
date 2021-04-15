module.exports = async function (context, req) {
    var body = req.body;
    context.res = {
        status: 200,
        body: body
    }
}